import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dataClient } from '../lib/data';
import { addRecentSession, getActiveGroup, getClientId, setActiveGroup } from '../lib/session';
import type { Allocation, Change, Group, Item, Person, ReceiptImage, Session } from '../lib/types';

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);

const applyChange = <T extends { id: string }>(list: T[], change: Change<T>): T[] => {
  if (change.type === 'DELETE') {
    return list.filter((item) => item.id !== change.record.id);
  }
  const existingIndex = list.findIndex((item) => item.id === change.record.id);
  if (existingIndex === -1) {
    return [...list, change.record];
  }
  const next = [...list];
  next[existingIndex] = change.record;
  return next;
};

type GroupFilter = 'all' | 'ungrouped' | string;

export function Workspace() {
  const { sessionId } = useParams();
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [receipts, setReceipts] = useState<ReceiptImage[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [personName, setPersonName] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [itemPrice, setItemPrice] = useState(0);
  const [taxInput, setTaxInput] = useState('0');
  const [tipInput, setTipInput] = useState('0');
  const [feesInput, setFeesInput] = useState('0');
  const [viewerOpen, setViewerOpen] = useState(false);
  const clientId = useMemo(() => getClientId(), []);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let unsubscribe = () => undefined;
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const sessionData = await dataClient.getSession(sessionId);
        if (!sessionData) {
          setError('Session not found.');
          setLoading(false);
          return;
        }
        const [groupData, peopleData, itemsData, receiptData, allocationData] = await Promise.all([
          dataClient.listGroups(sessionId),
          dataClient.listPeople(sessionId),
          dataClient.listItems(sessionId),
          dataClient.listReceipts(sessionId),
          dataClient.listAllocations(sessionId),
        ]);
        if (!mounted) {
          return;
        }
        setSession(sessionData);
        setGroups(groupData);
        setPeople(peopleData);
        setItems(itemsData);
        setReceipts(receiptData);
        setAllocations(allocationData);
        const savedFilter = getActiveGroup(sessionId);
        if (savedFilter) {
          setGroupFilter(savedFilter);
        }
        addRecentSession(sessionId);
        unsubscribe = dataClient.subscribe(sessionId, {
          onSession: (change) => setSession(change.record),
          onGroup: (change) => setGroups((prev) => applyChange(prev, change)),
          onPerson: (change) => setPeople((prev) => applyChange(prev, change)),
          onItem: (change) => setItems((prev) => applyChange(prev, change)),
          onReceipt: (change) => setReceipts((prev) => applyChange(prev, change)),
          onAllocation: (change) => setAllocations((prev) => applyChange(prev, change)),
        });
      } catch (err) {
        setError('Unable to load session data.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    setActiveGroup(sessionId, groupFilter);
  }, [groupFilter, sessionId]);

  useEffect(() => {
    if (!session) {
      return;
    }
    setTaxInput(session.tax_total.toString());
    setTipInput(session.tip_total.toString());
    setFeesInput(session.fees_total.toString());
  }, [session]);

  const locked = session?.status === 'LOCKED';
  const currency = session?.currency ?? 'USD';
  const groupsSorted = useMemo(
    () => [...groups].sort((a, b) => a.order - b.order),
    [groups]
  );
  const activeGroupId = groupFilter !== 'all' && groupFilter !== 'ungrouped' ? groupFilter : null;
  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    groupsSorted.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [groupsSorted]);
  const displayItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (item.parent_item_id && item.parent_item_id.length > 0) {
        return true;
      }
      return !item.is_exploded;
    });
    return filtered.filter((item) => {
      if (groupFilter === 'all') {
        return true;
      }
      if (groupFilter === 'ungrouped') {
        return !item.group_id;
      }
      return item.group_id === groupFilter;
    });
  }, [items, groupFilter]);
  const billableItems = useMemo(() => {
    return items.filter((item) => {
      if (item.parent_item_id && item.parent_item_id.length > 0) {
        return true;
      }
      return !item.is_exploded;
    });
  }, [items]);
  const subtotal = displayItems.reduce((sum, item) => sum + item.total_price, 0);
  const fullSubtotal = billableItems.reduce((sum, item) => sum + item.total_price, 0);
  const latestReceipt = useMemo(() => {
    if (receipts.length === 0) {
      return null;
    }
    return [...receipts].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) ?? null;
  }, [receipts]);

  const allocationMap = useMemo(() => {
    const map = new Map<string, Map<string, Allocation>>();
    allocations.forEach((allocation) => {
      if (!map.has(allocation.item_id)) {
        map.set(allocation.item_id, new Map());
      }
      map.get(allocation.item_id)?.set(allocation.person_id, allocation);
    });
    return map;
  }, [allocations]);

  const allocationTotals = useMemo(() => {
    const totals = new Map<string, number>();
    people.forEach((person) => totals.set(person.id, 0));
    let unassignedTotal = 0;

    billableItems.forEach((item) => {
      const itemAllocations = allocationMap.get(item.id);
      if (!itemAllocations || itemAllocations.size === 0) {
        unassignedTotal += item.total_price;
        return;
      }
      const allocationsList = [...itemAllocations.values()];
      const sharesTotal = allocationsList.reduce((sum, allocation) => sum + allocation.shares, 0);
      if (sharesTotal <= 0) {
        unassignedTotal += item.total_price;
        return;
      }
      allocationsList.forEach((allocation) => {
        const shareAmount = item.total_price * (allocation.shares / sharesTotal);
        totals.set(allocation.person_id, (totals.get(allocation.person_id) ?? 0) + shareAmount);
      });
    });

    return { totals, unassignedTotal };
  }, [billableItems, allocationMap, people]);

  const feeTotal = (session?.tax_total ?? 0) + (session?.tip_total ?? 0) + (session?.fees_total ?? 0);
  const feePerPerson = people.length > 0 ? feeTotal / people.length : 0;
  const grandTotal = fullSubtotal + feeTotal;

  const personTotals = useMemo(() => {
    const totals = new Map<string, number>();
    people.forEach((person) => {
      const itemTotal = allocationTotals.totals.get(person.id) ?? 0;
      totals.set(person.id, itemTotal + feePerPerson);
    });
    return totals;
  }, [people, allocationTotals, feePerPerson]);

  const handleAddPerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId || !personName.trim()) {
      return;
    }
    try {
      await dataClient.addPerson(sessionId, personName.trim());
      setPersonName('');
    } catch (err) {
      setError('Unable to add person.');
    }
  };

  const handleAddGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId || !groupName.trim()) {
      return;
    }
    try {
      const group = await dataClient.addGroup(sessionId, groupName.trim());
      setGroupName('');
      setGroupFilter(group.id);
    } catch (err) {
      setError('Unable to add group.');
    }
  };

  const handleAddItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId || !itemLabel.trim()) {
      return;
    }
    const quantity = Number(itemQty) || 1;
    const unitPrice = Number(itemPrice) || 0;
    const total = quantity * unitPrice;
    try {
      await dataClient.addItem(sessionId, {
        label: itemLabel.trim(),
        quantity,
        unit_price: unitPrice,
        total_price: total,
        group_id: activeGroupId,
      });
      setItemLabel('');
      setItemQty(1);
      setItemPrice(0);
    } catch (err) {
      setError('Unable to add item.');
    }
  };

  const handleLock = async () => {
    if (!sessionId || locked) {
      return;
    }
    try {
      await dataClient.updateSession(sessionId, {
        status: 'LOCKED',
        locked_at: new Date().toISOString(),
        locked_by: clientId,
      });
    } catch (err) {
      setError('Unable to lock session.');
    }
  };

  const handleExplode = async (item: Item) => {
    if (!sessionId || locked || item.quantity <= 1 || item.is_exploded) {
      return;
    }
    const count = Math.max(2, Math.round(item.quantity));
    try {
      await dataClient.updateItem(sessionId, item.id, { is_exploded: true });
      const baseLabel = item.label;
      for (let i = 1; i <= count; i += 1) {
        await dataClient.addItem(sessionId, {
          label: `${baseLabel} (${i}/${count})`,
          quantity: 1,
          unit_price: item.unit_price,
          total_price: item.unit_price,
          group_id: item.group_id ?? null,
          parent_item_id: item.id,
        });
      }
    } catch (err) {
      setError('Unable to explode item.');
    }
  };

  const handleToggleAllocation = async (itemId: string, personId: string) => {
    if (!sessionId || locked) {
      return;
    }
    try {
      const existing = allocationMap.get(itemId)?.get(personId);
      if (existing) {
        await dataClient.removeAllocation(sessionId, existing.id);
      } else {
        await dataClient.setAllocation(sessionId, { item_id: itemId, person_id: personId, shares: 1 });
      }
    } catch (err) {
      setError('Unable to update allocation.');
    }
  };

  const handleFeesUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId || locked) {
      return;
    }
    const tax = Number(taxInput) || 0;
    const tip = Number(tipInput) || 0;
    const fees = Number(feesInput) || 0;
    try {
      await dataClient.updateSession(sessionId, {
        tax_total: tax,
        tip_total: tip,
        fees_total: fees,
      });
    } catch (err) {
      setError('Unable to update fees.');
    }
  };

  if (loading) {
    return (
      <div className="app-shell">
        <div className="brand">
          <span className="brand-dot" />
          SplitScan
        </div>
        <p>Loading session...</p>
      </div>
    );
  }

  if (error || !sessionId || !session) {
    return (
      <div className="app-shell">
        <div className="brand">
          <span className="brand-dot" />
          SplitScan
        </div>
        <div className="panel">
          <h2>Unable to open session</h2>
          <p>{error ?? 'Missing session data.'}</p>
          <Link className="button secondary" to="/">
            Back to landing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div className="brand">
          <span className="brand-dot" />
          SplitScan
        </div>
        <span className="badge">Mode: {dataClient.mode}</span>
      </div>

      <section className="panel">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Session {session.id}</h2>
          <span className="badge">{session.status}</span>
        </div>
        <p className="caption">Client: {clientId}</p>
        {locked && <p className="notice">This session is locked. Edits are disabled for everyone.</p>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {!locked && (
            <button className="button secondary" onClick={handleLock}>
              Lock Session
            </button>
          )}
          {!locked ? (
            <Link className="button primary" to={`/${sessionId}/scan`}>
              Scan Receipt
            </Link>
          ) : (
            <button className="button primary" disabled>
              Scan Receipt
            </button>
          )}
        </div>
      </section>

      <section className="workspace-layout">
        <div className="panel">
          <h3 className="section-title">People</h3>
          <form onSubmit={handleAddPerson} className="grid">
            <input
              className="input"
              placeholder="Name"
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
              disabled={locked}
            />
            <button className="button primary" type="submit" disabled={locked}>
              Add Person
            </button>
          </form>
          <div className="list" style={{ marginTop: 16 }}>
            {people.length === 0 ? (
              <p className="caption">No one added yet.</p>
            ) : (
              people.map((person) => (
                <div key={person.id} className="list-item">
                  <span>{person.display_name}</span>
                  <span>{formatMoney(personTotals.get(person.id) ?? 0, currency)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">Items</h3>
          <div className="group-toolbar">
            <div className="group-tabs">
              <button
                className={`chip ${groupFilter === 'all' ? 'active' : ''}`}
                onClick={() => setGroupFilter('all')}
                type="button"
              >
                All Items
              </button>
              <button
                className={`chip ${groupFilter === 'ungrouped' ? 'active' : ''}`}
                onClick={() => setGroupFilter('ungrouped')}
                type="button"
              >
                Ungrouped
              </button>
              {groupsSorted.map((group) => (
                <button
                  key={group.id}
                  className={`chip ${groupFilter === group.id ? 'active' : ''}`}
                  onClick={() => setGroupFilter(group.id)}
                  type="button"
                >
                  {group.name}
                </button>
              ))}
            </div>
            <form onSubmit={handleAddGroup} className="group-form">
              <input
                className="input"
                placeholder="New group"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                disabled={locked}
              />
              <button className="button secondary" type="submit" disabled={locked}>
                Add Group
              </button>
            </form>
          </div>
          <form onSubmit={handleAddItem} className="grid">
            <input
              className="input"
              placeholder="Item label"
              value={itemLabel}
              onChange={(event) => setItemLabel(event.target.value)}
              disabled={locked}
            />
            <div className="grid two">
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={itemQty}
                onChange={(event) => setItemQty(Number(event.target.value))}
                disabled={locked}
              />
              <input
                className="input"
                type="number"
                min={0}
                step={0.01}
                value={itemPrice}
                onChange={(event) => setItemPrice(Number(event.target.value))}
                disabled={locked}
              />
            </div>
            <button className="button primary" type="submit" disabled={locked}>
              Add Item
            </button>
          </form>
          <div className="list" style={{ marginTop: 16 }}>
            {displayItems.length === 0 ? (
              <p className="caption">No items yet.</p>
            ) : (
              displayItems.map((item) => {
                const itemAllocations = allocationMap.get(item.id);
                const hasAllocations = itemAllocations && itemAllocations.size > 0;
                return (
                  <div key={item.id} className="list-item item-row">
                    <div style={{ flex: 1 }}>
                      <div className="item-title">
                        {item.label} x{item.quantity}
                      </div>
                      <div className="caption">
                        {item.group_id ? groupNameById.get(item.group_id) ?? 'Group' : 'Ungrouped'}
                        {item.parent_item_id ? ' • Exploded' : ''}
                        {!hasAllocations ? ' • Unassigned' : ''}
                      </div>
                      <div className="assignment-row">
                        <span className="caption">Assign</span>
                        <div className="chip-row">
                          {people.length === 0 ? (
                            <span className="caption">Add people to assign items.</span>
                          ) : (
                            people.map((person) => {
                              const assigned = itemAllocations?.has(person.id);
                              return (
                                <button
                                  key={person.id}
                                  className={`chip ${assigned ? 'active' : ''}`}
                                  type="button"
                                  onClick={() => handleToggleAllocation(item.id, person.id)}
                                  disabled={locked}
                                  aria-pressed={assigned}
                                >
                                  {person.display_name}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {item.quantity > 1 && !item.is_exploded && !item.parent_item_id && (
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => handleExplode(item)}
                          disabled={locked}
                        >
                          Explode
                        </button>
                      )}
                      <span>{formatMoney(item.total_price, currency)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
            <span className="caption">Subtotal</span>
            <strong>{formatMoney(subtotal, currency)}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3 className="section-title">Totals & Fees</h3>
        <form onSubmit={handleFeesUpdate} className="grid">
          <div className="grid two">
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={taxInput}
              onChange={(event) => setTaxInput(event.target.value)}
              disabled={locked}
              placeholder="Tax"
            />
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={tipInput}
              onChange={(event) => setTipInput(event.target.value)}
              disabled={locked}
              placeholder="Tip"
            />
          </div>
          <div className="grid two">
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={feesInput}
              onChange={(event) => setFeesInput(event.target.value)}
              disabled={locked}
              placeholder="Additional fees"
            />
            <button className="button secondary" type="submit" disabled={locked}>
              Update Fees
            </button>
          </div>
        </form>
        <div className="summary-grid">
          <div className="summary-row">
            <span className="caption">Items subtotal</span>
            <strong>{formatMoney(fullSubtotal, currency)}</strong>
          </div>
          <div className="summary-row">
            <span className="caption">Fees total</span>
            <strong>{formatMoney(feeTotal, currency)}</strong>
          </div>
          <div className="summary-row">
            <span className="caption">Unassigned items</span>
            <strong>{formatMoney(allocationTotals.unassignedTotal, currency)}</strong>
          </div>
          <div className="summary-row">
            <span className="caption">Grand total</span>
            <strong>{formatMoney(grandTotal, currency)}</strong>
          </div>
          <div className="summary-row">
            <span className="caption">Equal fee share / person</span>
            <strong>{formatMoney(feePerPerson, currency)}</strong>
          </div>
        </div>
        <div className="list" style={{ marginTop: 16 }}>
          {people.length === 0 ? (
            <p className="caption">Add people to see per-person totals.</p>
          ) : (
            people.map((person) => (
              <div key={person.id} className="list-item">
                <span>{person.display_name}</span>
                <span>{formatMoney(personTotals.get(person.id) ?? 0, currency)}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <h3 className="section-title">Receipt</h3>
        {!latestReceipt ? (
          <p className="caption">No receipt image yet. Scan one to attach it here.</p>
        ) : (
          <div className="receipt-card">
            <img src={latestReceipt.image_url} alt="Receipt" />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="caption">
                {latestReceipt.width} × {latestReceipt.height}
              </span>
              <button className="button secondary" onClick={() => setViewerOpen(true)}>
                View Full Size
              </button>
            </div>
          </div>
        )}
      </section>

      {viewerOpen && latestReceipt && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-content">
            <button className="button secondary" onClick={() => setViewerOpen(false)}>
              Close
            </button>
            <div className="modal-image">
              <img src={latestReceipt.image_url} alt="Receipt full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
