import { signInAnonymously } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { firebaseAuth, firebaseStorage, firestoreDb, hasFirebase } from './firebase';
import { addRecentSession, generateId } from './session';
import type {
  Allocation,
  Change,
  Group,
  Item,
  Person,
  ReceiptImage,
  Session,
  SubscriptionHandlers,
} from './types';

type SessionPatch = Partial<
  Pick<
    Session,
    | 'status'
    | 'locked_at'
    | 'locked_by'
    | 'tax_total'
    | 'tip_total'
    | 'fees_total'
    | 'equal_split_paid_by'
  >
>;

type DataClient = {
  mode: 'firebase' | 'local';
  createSession: () => Promise<Session>;
  getSession: (id: string) => Promise<Session | null>;
  listGroups: (sessionId: string) => Promise<Group[]>;
  listPeople: (sessionId: string) => Promise<Person[]>;
  listItems: (sessionId: string) => Promise<Item[]>;
  listReceipts: (sessionId: string) => Promise<ReceiptImage[]>;
  listAllocations: (sessionId: string) => Promise<Allocation[]>;
  addGroup: (sessionId: string, name: string) => Promise<Group>;
  addPerson: (sessionId: string, displayName: string) => Promise<Person>;
  updatePerson: (sessionId: string, personId: string, patch: Partial<Person>) => Promise<Person>;
  addItem: (
    sessionId: string,
    input: {
      label: string;
      quantity: number;
      unit_price: number;
      total_price: number;
      group_id?: string | null;
      is_exploded?: boolean;
      parent_item_id?: string | null;
    }
  ) => Promise<Item>;
  updateItem: (sessionId: string, itemId: string, patch: Partial<Item>) => Promise<Item>;
  setAllocation: (
    sessionId: string,
    input: { item_id: string; person_id: string; shares: number }
  ) => Promise<Allocation>;
  removeAllocation: (sessionId: string, allocationId: string) => Promise<void>;
  addReceiptImage: (
    sessionId: string,
    input: { dataUrl: string; width: number; height: number }
  ) => Promise<ReceiptImage>;
  updateSession: (sessionId: string, patch: SessionPatch) => Promise<Session>;
  subscribe: (sessionId: string, handlers: SubscriptionHandlers) => () => void;
};

const numberize = (value: unknown) => (typeof value === 'string' ? Number(value) : (value as number));

const normalizeSession = (raw: Session): Session => ({
  ...raw,
  tax_total: numberize(raw.tax_total),
  tip_total: numberize(raw.tip_total),
  fees_total: numberize(raw.fees_total),
  equal_split_paid_by:
    raw.equal_split_paid_by && typeof raw.equal_split_paid_by === 'object'
      ? Object.fromEntries(
          Object.entries(raw.equal_split_paid_by).filter(
            ([key, value]) => typeof key === 'string' && typeof value === 'string'
          )
        )
      : {},
});

const normalizeItem = (raw: Item): Item => ({
  ...raw,
  group_id: raw.group_id ?? null,
  quantity: numberize(raw.quantity),
  unit_price: numberize(raw.unit_price),
  total_price: numberize(raw.total_price),
  is_exploded: raw.is_exploded ?? false,
  parent_item_id: raw.parent_item_id ?? null,
});

const normalizeAllocation = (raw: Allocation): Allocation => ({
  ...raw,
  shares: numberize(raw.shares),
});

const channelMap = new Map<string, BroadcastChannel>();

const getChannel = (sessionId: string) => {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channelMap.has(sessionId)) {
    channelMap.set(sessionId, new BroadcastChannel(`splitscan:${sessionId}`));
  }
  return channelMap.get(sessionId) ?? null;
};

const readJson = <T,>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const sessionKey = (id: string) => `splitscan_session_${id}`;
const groupsKey = (id: string) => `splitscan_groups_${id}`;
const peopleKey = (id: string) => `splitscan_people_${id}`;
const itemsKey = (id: string) => `splitscan_items_${id}`;
const receiptsKey = (id: string) => `splitscan_receipts_${id}`;
const allocationsKey = (id: string) => `splitscan_allocations_${id}`;

const allocationIdFor = (itemId: string, personId: string) => `${itemId}_${personId}`;

const localClient: DataClient = {
  mode: 'local',
  async createSession() {
    const id = generateId(12);
    const now = new Date().toISOString();
    const session: Session = {
      id,
      status: 'ACTIVE',
      currency: 'USD',
      tax_total: 0,
      tip_total: 0,
      fees_total: 0,
      equal_split_paid_by: {},
      created_at: now,
      updated_at: now,
      locked_at: null,
      locked_by: null,
    };
    writeJson(sessionKey(id), session);
    writeJson(groupsKey(id), []);
    writeJson(peopleKey(id), []);
    writeJson(itemsKey(id), []);
    writeJson(receiptsKey(id), []);
    writeJson(allocationsKey(id), []);
    addRecentSession(id);
    getChannel(id)?.postMessage({ scope: 'session', change: { type: 'INSERT', record: session } });
    return session;
  },
  async getSession(id) {
    const session = readJson<Session | null>(sessionKey(id), null);
    return session ? normalizeSession(session as Session) : null;
  },
  async listGroups(sessionId) {
    return readJson<Group[]>(groupsKey(sessionId), []);
  },
  async listPeople(sessionId) {
    return readJson<Person[]>(peopleKey(sessionId), []);
  },
  async listItems(sessionId) {
    return readJson<Item[]>(itemsKey(sessionId), []).map((item) => ({
      ...item,
      group_id: item.group_id ?? null,
      is_exploded: item.is_exploded ?? false,
      parent_item_id: item.parent_item_id ?? null,
    }));
  },
  async listReceipts(sessionId) {
    return readJson<ReceiptImage[]>(receiptsKey(sessionId), []);
  },
  async listAllocations(sessionId) {
    return readJson<Allocation[]>(allocationsKey(sessionId), []);
  },
  async addGroup(sessionId, name) {
    const now = new Date().toISOString();
    const groups = readJson<Group[]>(groupsKey(sessionId), []);
    const order = groups.length;
    const group: Group = {
      id: generateId(8),
      session_id: sessionId,
      name,
      order,
      created_at: now,
      updated_at: now,
    };
    const next = [...groups, group];
    writeJson(groupsKey(sessionId), next);
    getChannel(sessionId)?.postMessage({ scope: 'group', change: { type: 'INSERT', record: group } });
    return group;
  },
  async addPerson(sessionId, displayName) {
    const now = new Date().toISOString();
    const person: Person = {
      id: generateId(10),
      session_id: sessionId,
      display_name: displayName,
      created_at: now,
      updated_at: now,
    };
    const people = readJson<Person[]>(peopleKey(sessionId), []);
    const next = [...people, person];
    writeJson(peopleKey(sessionId), next);
    getChannel(sessionId)?.postMessage({ scope: 'person', change: { type: 'INSERT', record: person } });
    return person;
  },
  async updatePerson(sessionId, personId, patch) {
    const people = readJson<Person[]>(peopleKey(sessionId), []);
    const index = people.findIndex((person) => person.id === personId);
    if (index === -1) {
      throw new Error('Person not found');
    }
    const nextPerson: Person = {
      ...people[index],
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const next = [...people];
    next[index] = nextPerson;
    writeJson(peopleKey(sessionId), next);
    getChannel(sessionId)?.postMessage({ scope: 'person', change: { type: 'UPDATE', record: nextPerson } });
    return nextPerson;
  },
  async addItem(sessionId, input) {
    const now = new Date().toISOString();
    const item: Item = {
      id: generateId(10),
      session_id: sessionId,
      group_id: input.group_id ?? null,
      label: input.label,
      quantity: input.quantity,
      unit_price: input.unit_price,
      total_price: input.total_price,
      is_exploded: input.is_exploded ?? false,
      parent_item_id: input.parent_item_id ?? null,
      created_at: now,
      updated_at: now,
    };
    const items = readJson<Item[]>(itemsKey(sessionId), []);
    const next = [...items, item];
    writeJson(itemsKey(sessionId), next);
    getChannel(sessionId)?.postMessage({ scope: 'item', change: { type: 'INSERT', record: item } });
    return item;
  },
  async updateItem(sessionId, itemId, patch) {
    const session = readJson<Session | null>(sessionKey(sessionId), null);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.status === 'LOCKED') {
      throw new Error('Session is locked');
    }
    const items = readJson<Item[]>(itemsKey(sessionId), []);
    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1) {
      throw new Error('Item not found');
    }
    const nextItem = {
      ...items[index],
      ...patch,
      updated_at: new Date().toISOString(),
    } as Item;
    const next = [...items];
    next[index] = nextItem;
    writeJson(itemsKey(sessionId), next);
    getChannel(sessionId)?.postMessage({ scope: 'item', change: { type: 'UPDATE', record: nextItem } });
    return nextItem;
  },
  async setAllocation(sessionId, input) {
    const session = readJson<Session | null>(sessionKey(sessionId), null);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.status === 'LOCKED') {
      throw new Error('Session is locked');
    }
    const allocations = readJson<Allocation[]>(allocationsKey(sessionId), []);
    const id = allocationIdFor(input.item_id, input.person_id);
    const now = new Date().toISOString();
    const index = allocations.findIndex((allocation) => allocation.id === id);
    if (input.shares <= 0) {
      if (index !== -1) {
        const next = allocations.filter((allocation) => allocation.id !== id);
        writeJson(allocationsKey(sessionId), next);
        getChannel(sessionId)?.postMessage({
          scope: 'allocation',
          change: { type: 'DELETE', record: allocations[index] },
        });
      }
      return {
        id,
        session_id: sessionId,
        item_id: input.item_id,
        person_id: input.person_id,
        shares: 0,
        created_at: now,
        updated_at: now,
      };
    }
    const nextAllocation: Allocation =
      index === -1
        ? {
            id,
            session_id: sessionId,
            item_id: input.item_id,
            person_id: input.person_id,
            shares: input.shares,
            created_at: now,
            updated_at: now,
          }
        : {
            ...allocations[index],
            shares: input.shares,
            updated_at: now,
          };
    const next = [...allocations];
    if (index === -1) {
      next.push(nextAllocation);
      getChannel(sessionId)?.postMessage({
        scope: 'allocation',
        change: { type: 'INSERT', record: nextAllocation },
      });
    } else {
      next[index] = nextAllocation;
      getChannel(sessionId)?.postMessage({
        scope: 'allocation',
        change: { type: 'UPDATE', record: nextAllocation },
      });
    }
    writeJson(allocationsKey(sessionId), next);
    return nextAllocation;
  },
  async removeAllocation(sessionId, allocationId) {
    const session = readJson<Session | null>(sessionKey(sessionId), null);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.status === 'LOCKED') {
      throw new Error('Session is locked');
    }
    const allocations = readJson<Allocation[]>(allocationsKey(sessionId), []);
    const index = allocations.findIndex((allocation) => allocation.id === allocationId);
    if (index === -1) {
      return;
    }
    const next = allocations.filter((allocation) => allocation.id !== allocationId);
    writeJson(allocationsKey(sessionId), next);
    getChannel(sessionId)?.postMessage({
      scope: 'allocation',
      change: { type: 'DELETE', record: allocations[index] },
    });
  },
  async addReceiptImage(sessionId, input) {
    const now = new Date().toISOString();
    const receipt: ReceiptImage = {
      id: generateId(10),
      session_id: sessionId,
      image_url: input.dataUrl,
      width: input.width,
      height: input.height,
      created_at: now,
    };
    const receipts = readJson<ReceiptImage[]>(receiptsKey(sessionId), []);
    const next = [...receipts, receipt];
    writeJson(receiptsKey(sessionId), next);
    getChannel(sessionId)?.postMessage({ scope: 'receipt', change: { type: 'INSERT', record: receipt } });
    return receipt;
  },
  async updateSession(sessionId, patch) {
    const session = readJson<Session | null>(sessionKey(sessionId), null);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.status === 'LOCKED') {
      throw new Error('Session is locked');
    }
    const next: Session = {
      ...session,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    writeJson(sessionKey(sessionId), next);
    getChannel(sessionId)?.postMessage({ scope: 'session', change: { type: 'UPDATE', record: next } });
    return next;
  },
  subscribe(sessionId, handlers) {
    const channel = getChannel(sessionId);
    if (!channel) {
      return () => undefined;
    }
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as {
        scope: string;
        change: Change<Session | Group | Person | Item | ReceiptImage>;
      } | null;
      if (!payload) {
        return;
      }
      if (payload.scope === 'session' && handlers.onSession) {
        handlers.onSession(payload.change as Change<Session>);
      }
      if (payload.scope === 'group' && handlers.onGroup) {
        handlers.onGroup(payload.change as Change<Group>);
      }
      if (payload.scope === 'person' && handlers.onPerson) {
        handlers.onPerson(payload.change as Change<Person>);
      }
      if (payload.scope === 'item' && handlers.onItem) {
        handlers.onItem(payload.change as Change<Item>);
      }
      if (payload.scope === 'receipt' && handlers.onReceipt) {
        handlers.onReceipt(payload.change as Change<ReceiptImage>);
      }
      if (payload.scope === 'allocation' && handlers.onAllocation) {
        handlers.onAllocation(payload.change as Change<Allocation>);
      }
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
    };
  },
};

const ensureAuth = async () => {
  if (!firebaseAuth) {
    throw new Error('Firebase auth not configured');
  }
  if (firebaseAuth.currentUser) {
    return firebaseAuth.currentUser;
  }
  const result = await signInAnonymously(firebaseAuth);
  return result.user;
};

const firebaseClient: DataClient = {
  mode: 'firebase',
  async createSession() {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const id = generateId(12);
    const now = new Date().toISOString();
    const session: Session = {
      id,
      status: 'ACTIVE',
      currency: 'USD',
      tax_total: 0,
      tip_total: 0,
      fees_total: 0,
      equal_split_paid_by: {},
      created_at: now,
      updated_at: now,
      locked_at: null,
      locked_by: null,
    };
    await setDoc(doc(firestoreDb, 'sessions', id), session);
    addRecentSession(id);
    return session;
  },
  async getSession(id) {
    if (!firestoreDb) {
      return null;
    }
    await ensureAuth();
    const snapshot = await getDoc(doc(firestoreDb, 'sessions', id));
    if (!snapshot.exists()) {
      return null;
    }
    return normalizeSession(snapshot.data() as Session);
  },
  async listGroups(sessionId) {
    if (!firestoreDb) {
      return [];
    }
    await ensureAuth();
    const ref = collection(firestoreDb, 'sessions', sessionId, 'groups');
    const snapshot = await getDocs(query(ref, orderBy('order', 'asc')));
    return snapshot.docs.map((docSnap) => docSnap.data() as Group);
  },
  async listPeople(sessionId) {
    if (!firestoreDb) {
      return [];
    }
    await ensureAuth();
    const ref = collection(firestoreDb, 'sessions', sessionId, 'people');
    const snapshot = await getDocs(query(ref, orderBy('created_at', 'asc')));
    return snapshot.docs.map((docSnap) => docSnap.data() as Person);
  },
  async listItems(sessionId) {
    if (!firestoreDb) {
      return [];
    }
    await ensureAuth();
    const ref = collection(firestoreDb, 'sessions', sessionId, 'items');
    const snapshot = await getDocs(query(ref, orderBy('created_at', 'asc')));
    return snapshot.docs.map((docSnap) => normalizeItem(docSnap.data() as Item));
  },
  async listReceipts(sessionId) {
    if (!firestoreDb) {
      return [];
    }
    await ensureAuth();
    const ref = collection(firestoreDb, 'sessions', sessionId, 'receipts');
    const snapshot = await getDocs(query(ref, orderBy('created_at', 'asc')));
    return snapshot.docs.map((docSnap) => docSnap.data() as ReceiptImage);
  },
  async listAllocations(sessionId) {
    if (!firestoreDb) {
      return [];
    }
    await ensureAuth();
    const ref = collection(firestoreDb, 'sessions', sessionId, 'allocations');
    const snapshot = await getDocs(query(ref, orderBy('created_at', 'asc')));
    return snapshot.docs.map((docSnap) => normalizeAllocation(docSnap.data() as Allocation));
  },
  async addGroup(sessionId, name) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const now = new Date().toISOString();
    const groupId = generateId(8);
    const ref = collection(firestoreDb, 'sessions', sessionId, 'groups');
    const snapshot = await getDocs(query(ref, orderBy('order', 'asc')));
    const order = snapshot.size;
    const group: Group = {
      id: groupId,
      session_id: sessionId,
      name,
      order,
      created_at: now,
      updated_at: now,
    };
    await setDoc(doc(firestoreDb, 'sessions', sessionId, 'groups', groupId), group);
    return group;
  },
  async addPerson(sessionId, displayName) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const now = new Date().toISOString();
    const person: Person = {
      id: generateId(10),
      session_id: sessionId,
      display_name: displayName,
      created_at: now,
      updated_at: now,
    };
    await setDoc(doc(firestoreDb, 'sessions', sessionId, 'people', person.id), person);
    return person;
  },
  async updatePerson(sessionId, personId, patch) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const refDoc = doc(firestoreDb, 'sessions', sessionId, 'people', personId);
    await updateDoc(refDoc, { ...patch, updated_at: new Date().toISOString() });
    const snapshot = await getDoc(refDoc);
    return snapshot.data() as Person;
  },
  async addItem(sessionId, input) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const now = new Date().toISOString();
    const item: Item = {
      id: generateId(10),
      session_id: sessionId,
      group_id: input.group_id ?? null,
      label: input.label,
      quantity: input.quantity,
      unit_price: input.unit_price,
      total_price: input.total_price,
      is_exploded: input.is_exploded ?? false,
      parent_item_id: input.parent_item_id ?? null,
      created_at: now,
      updated_at: now,
    };
    await setDoc(doc(firestoreDb, 'sessions', sessionId, 'items', item.id), item);
    return item;
  },
  async updateItem(sessionId, itemId, patch) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const refDoc = doc(firestoreDb, 'sessions', sessionId, 'items', itemId);
    await updateDoc(refDoc, { ...patch, updated_at: new Date().toISOString() });
    const snapshot = await getDoc(refDoc);
    return normalizeItem(snapshot.data() as Item);
  },
  async setAllocation(sessionId, input) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const now = new Date().toISOString();
    const id = allocationIdFor(input.item_id, input.person_id);
    const allocation: Allocation = {
      id,
      session_id: sessionId,
      item_id: input.item_id,
      person_id: input.person_id,
      shares: input.shares,
      created_at: now,
      updated_at: now,
    };
    const refDoc = doc(firestoreDb, 'sessions', sessionId, 'allocations', id);
    await setDoc(refDoc, allocation);
    return allocation;
  },
  async removeAllocation(sessionId, allocationId) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    await deleteDoc(doc(firestoreDb, 'sessions', sessionId, 'allocations', allocationId));
  },
  async addReceiptImage(sessionId, input) {
    if (!firestoreDb || !firebaseStorage) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const now = new Date().toISOString();
    const id = generateId(10);
    const storageRef = ref(firebaseStorage, `sessions/${sessionId}/receipts/${id}.jpg`);
    await uploadString(storageRef, input.dataUrl, 'data_url');
    const imageUrl = await getDownloadURL(storageRef);
    const receipt: ReceiptImage = {
      id,
      session_id: sessionId,
      image_url: imageUrl,
      width: input.width,
      height: input.height,
      created_at: now,
    };
    await setDoc(doc(firestoreDb, 'sessions', sessionId, 'receipts', id), receipt);
    return receipt;
  },
  async updateSession(sessionId, patch) {
    if (!firestoreDb) {
      throw new Error('Firebase is not configured');
    }
    await ensureAuth();
    const refDoc = doc(firestoreDb, 'sessions', sessionId);
    await updateDoc(refDoc, { ...patch, updated_at: new Date().toISOString() });
    const snapshot = await getDoc(refDoc);
    return normalizeSession(snapshot.data() as Session);
  },
  subscribe(sessionId, handlers) {
    if (!firestoreDb) {
      return () => undefined;
    }
    let unsubSession = () => undefined;
    let unsubGroups = () => undefined;
    let unsubPeople = () => undefined;
    let unsubItems = () => undefined;
    let unsubReceipts = () => undefined;
    let unsubAllocations = () => undefined;
    let active = true;

    ensureAuth()
      .then(() => {
        if (!active) {
          return;
        }
        const sessionRef = doc(firestoreDb, 'sessions', sessionId);
        unsubSession = onSnapshot(sessionRef, (snapshot) => {
          if (!handlers.onSession || !snapshot.exists()) {
            return;
          }
          handlers.onSession({ type: 'UPDATE', record: normalizeSession(snapshot.data() as Session) });
        });

        const groupsRef = collection(firestoreDb, 'sessions', sessionId, 'groups');
        unsubGroups = onSnapshot(query(groupsRef, orderBy('order', 'asc')), (snapshot) => {
          if (!handlers.onGroup) {
            return;
          }
          snapshot.docChanges().forEach((change) => {
            const type = change.type === 'added' ? 'INSERT' : change.type === 'modified' ? 'UPDATE' : 'DELETE';
            handlers.onGroup({ type, record: change.doc.data() as Group });
          });
        });

        const peopleRef = collection(firestoreDb, 'sessions', sessionId, 'people');
        unsubPeople = onSnapshot(query(peopleRef, orderBy('created_at', 'asc')), (snapshot) => {
          if (!handlers.onPerson) {
            return;
          }
          snapshot.docChanges().forEach((change) => {
            const type = change.type === 'added' ? 'INSERT' : change.type === 'modified' ? 'UPDATE' : 'DELETE';
            handlers.onPerson({ type, record: change.doc.data() as Person });
          });
        });

        const itemsRef = collection(firestoreDb, 'sessions', sessionId, 'items');
        unsubItems = onSnapshot(query(itemsRef, orderBy('created_at', 'asc')), (snapshot) => {
          if (!handlers.onItem) {
            return;
          }
          snapshot.docChanges().forEach((change) => {
            const type = change.type === 'added' ? 'INSERT' : change.type === 'modified' ? 'UPDATE' : 'DELETE';
            handlers.onItem({ type, record: normalizeItem(change.doc.data() as Item) });
          });
        });

        const receiptsRef = collection(firestoreDb, 'sessions', sessionId, 'receipts');
        unsubReceipts = onSnapshot(query(receiptsRef, orderBy('created_at', 'asc')), (snapshot) => {
          if (!handlers.onReceipt) {
            return;
          }
          snapshot.docChanges().forEach((change) => {
            const type = change.type === 'added' ? 'INSERT' : change.type === 'modified' ? 'UPDATE' : 'DELETE';
            handlers.onReceipt({ type, record: change.doc.data() as ReceiptImage });
          });
        });

        const allocationsRef = collection(firestoreDb, 'sessions', sessionId, 'allocations');
        unsubAllocations = onSnapshot(query(allocationsRef, orderBy('created_at', 'asc')), (snapshot) => {
          if (!handlers.onAllocation) {
            return;
          }
          snapshot.docChanges().forEach((change) => {
            const type = change.type === 'added' ? 'INSERT' : change.type === 'modified' ? 'UPDATE' : 'DELETE';
            handlers.onAllocation({ type, record: normalizeAllocation(change.doc.data() as Allocation) });
          });
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubSession();
      unsubGroups();
      unsubPeople();
      unsubItems();
      unsubReceipts();
      unsubAllocations();
    };
  },
};

export const dataClient: DataClient = hasFirebase ? firebaseClient : localClient;
