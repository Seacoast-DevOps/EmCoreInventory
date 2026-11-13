import { ClearInput, ClearTextarea, SearchSelect } from "./FormControls.jsx";
import { useState } from "react";
import {
  ArrowRightLeft,
  History as HistoryIcon,
  Plus,
  Search,
  QrCode,
  ScanLine,
} from "lucide-react";
import { request, useInventory, confirmedSeals } from "./api.js";
import StorageBrowser from "./StorageBrowser.jsx";
import Modal, { SealQuestion } from "./Modal.jsx";
import History from "./History.jsx";
import CheckControls from "./CheckControls.jsx";
import { useAccess } from "./access-state.js";
import { definitionLabel } from "../shared/catalog-options.js";

function MoveItem({ item, data, onSaved, onClose }) {
  const [destination, setDestination] = useState("");
  const [witnessNeeded, setWitnessNeeded] = useState(
    item.requirements?.includes("transfer") || false,
  );
  const [seals, setSeals] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!destination || destination === item.box_id)
      return setError("Choose a different container.");
    setBusy(true);
    setError("");
    try {
      const result = await request("move", {
        itemId: item.id,
        sourceId: item.box_id,
        destinationId: destination,
        brokenSeals: seals ? confirmedSeals(seals) : [],
      });
      onSaved(result);
      onClose();
    } catch (error) {
      if (error.witnessRequired) setWitnessNeeded(true);
      if (error.sealedBoxes) setSeals(error.sealedBoxes);
      else setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={seals ? "Has the seal been broken?" : "Move item"}
      onClose={onClose}
      busy={busy}
    >
      <p>
        <strong>{item.medication}</strong>
        <br />
        {item.presentation} · <code>{item.code}</code>
      </p>
      {seals ? (
        <SealQuestion boxes={seals} />
      ) : (
        <>
          <label className="field-label" htmlFor="destination">
            Move to
          </label>
          <SearchSelect
            id="destination"
            className="form-select"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="">Choose a different container</option>
            {data.boxes
              .filter((box) => box.id !== item.box_id)
              .map((box) => (
                <option value={box.id} key={box.id}>
                  {box.location} — {box.name}
                  {box.sealed ? " · SEALED" : ""}
                </option>
              ))}
          </SearchSelect>
        </>
      )}
      {witnessNeeded && (
        <p className="policy-note">
          A second user will sign in to witness this transfer when you save.
        </p>
      )}
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="cancel-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="action-primary"
          disabled={busy || !destination || destination === item.box_id}
          onClick={submit}
        >
          {busy ? "Saving…" : seals ? "Yes, seals broken — move" : "Move item"}
        </button>
      </div>
    </Modal>
  );
}

function NewDrug({ data, onSaved, onClose, onManage }) {
  const { can, canDrug } = useAccess();
  const [lotNumber, setLotNumber] = useState(""),
    [expirationDate, setExpirationDate] = useState("");
  const [definitionId, setDefinitionId] = useState(""),
    [quantity, setQuantity] = useState(1);
  const [codeMode, setCodeMode] = useState("auto"),
    [codesText, setCodesText] = useState("");
  const [replacement, setReplacement] = useState(false),
    [witnessNeeded, setWitnessNeeded] = useState(false);
  const [seals, setSeals] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const drug = data.definitions.find((drug) => drug.id === definitionId);
  const requiresReplacementWitness =
    replacement &&
    drug?.tagIds.some((id) =>
      data.tags
        .find((tag) => tag.id === id)
        ?.requirements.includes("replacement"),
    );
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request("drugs", {
        definitionId,
        quantity: Number(quantity),
        lotNumber,
        expirationDate,
        batchCreate: true,
        replacement,
        codeMode,
        codes:
          codeMode === "manual"
            ? codesText
                .trim()
                .split(/[\s,]+/)
                .filter(Boolean)
            : undefined,
        brokenSeals: seals ? confirmedSeals(seals) : [],
      });
      onSaved(result);
      onClose();
    } catch (error) {
      if (error.witnessRequired) setWitnessNeeded(true);
      if (error.sealedBoxes) setSeals(error.sealedBoxes);
      else setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={seals ? "Has the seal been broken?" : "Receive drug"}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        {seals ? (
          <SealQuestion boxes={seals} />
        ) : (
          <div className="form-stack">
            <label>
              Standardized drug
              <SearchSelect
                clearLabel="Standardized drug"
                aria-label="Standardized drug"
                className="form-select"
                required
                value={definitionId}
                onChange={(event) => setDefinitionId(event.target.value)}
              >
                <option value="">Choose a drug and concentration</option>
                {data.definitions
                  .filter(
                    (drug) => canDrug(drug, "create") && canDrug(drug, "view"),
                  )
                  .map((drug) => (
                    <option key={drug.id} value={drug.id}>
                      {definitionLabel(drug)}
                    </option>
                  ))}
              </SearchSelect>
            </label>
            {!data.definitions.length && (
              <p>Add your first definition in Manage Par Levels.</p>
            )}
            <button
              type="button"
              className="text-button"
              disabled={!can("definitions.view")}
              onClick={onManage}
            >
              Manage Par Levels
            </button>
            {drug && (
              <div className="medication-tags">
                {drug.tagIds.map((id) => (
                  <span key={id}>
                    {data.tags.find((tag) => tag.id === id)?.name}
                  </span>
                ))}
              </div>
            )}
            <label>
              Number of individual items
              <ClearInput
                clearLabel="Number of individual items"
                className="form-control"
                type="number"
                min="1"
                max="1000"
                step="1"
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <label>
              Lot number
              <ClearInput
                clearLabel="Lot number"
                aria-label="Lot number"
                className="form-control"
                maxLength={80}
                required
                value={lotNumber}
                onChange={(event) => setLotNumber(event.target.value)}
              />
            </label>
            <label>
              Expiration date
              <ClearInput
                clearLabel="Expiration date"
                aria-label="Expiration date"
                className="form-control"
                type="date"
                required
                value={expirationDate}
                onChange={(event) => setExpirationDate(event.target.value)}
              />
            </label>
            <p className="field-help">
              Every item in this batch shares this lot and expiration. New stock
              is Unassigned; transfer it to a container afterward.
            </p>
            <label>
              Tracking codes
              <SearchSelect
                clearLabel="Tracking codes"
                aria-label="Tracking code assignment"
                className="form-select"
                value={codeMode}
                onChange={(event) => setCodeMode(event.target.value)}
              >
                <option value="auto">Generate unique codes</option>
                <option value="manual">Enter codes manually</option>
              </SearchSelect>
            </label>
            {codeMode === "manual" && (
              <label>
                Eight-character codes (one per item)
                <ClearTextarea
                  clearLabel="Eight-character codes (one per item)"
                  className="form-control"
                  required
                  rows={3}
                  value={codesText}
                  onChange={(event) =>
                    setCodesText(event.target.value.toUpperCase())
                  }
                  placeholder="AB12CD34"
                />
              </label>
            )}
            <label className="settings-check">
              <ClearInput
                type="checkbox"
                checked={replacement}
                onChange={(event) => setReplacement(event.target.checked)}
              />
              <span>Replacement stock</span>
            </label>
          </div>
        )}
        {(witnessNeeded || requiresReplacementWitness) && (
          <p className="policy-note">
            A second user will sign in to witness this receipt when you save.
          </p>
        )}
        {error && (
          <p role="alert" className="error-note">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="cancel-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="action-primary" disabled={busy || !definitionId}>
            {busy
              ? "Saving…"
              : seals
                ? "Yes, seals broken — add"
                : "Receive drug"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Inventory({
  onManage,
  onScan,
  initialReceive = false,
}) {
  const { can, canDrug } = useAccess();
  const drugFor = (item) =>
    data?.definitions.find((drug) => drug.id === item.definition_id) || item;
  const { data, setData, error, setError, reload } = useInventory();
  const [location, setLocation] = useState("Unit 42"),
    [moving, setMoving] = useState(null),
    [creating, setCreating] = useState(initialReceive);
  const [qr, setQr] = useState(false);
  const [history, setHistory] = useState(""),
    [lookup, setLookup] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [pendingVerification, setPendingVerification] = useState(null);
  async function onCheckAction(path, body) {
    setBusy(true);
    setError("");
    try {
      setData(await request(path, body));
      setNotice(
        path.endsWith("complete")
          ? "Check complete. Enable Show completed checks to view it."
          : path.endsWith("start")
            ? "Check started. Progress will be saved."
            : "Check progress saved.",
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(item) {
    const check = data.checks.find((check) => check.boxId === item.box_id);
    if (!check?.draft) return setError("Start this container check first.");
    const verified = !check.checkedIds.includes(item.id);
    setPendingVerification({ id: item.id, value: verified });
    try {
      await onCheckAction("checks/verify", {
        boxId: item.box_id,
        revision: check.draft.revision,
        itemId: item.id,
        verified,
      });
    } finally {
      setPendingVerification(null);
    }
  }
  if (!data)
    return (
      <section className="card">
        <p role="status">{error || "Loading inventory…"}</p>
        {error && (
          <button className="action-primary" onClick={reload}>
            Retry
          </button>
        )}
      </section>
    );
  return (
    <section aria-label="Inventory contents">
      <div className="inventory-actions">
        <button
          className="cancel-button"
          disabled={!can("records.view")}
          onClick={onScan}
        >
          <ScanLine size={18} /> Scan QR
        </button>
        <button
          className="action-primary"
          disabled={!can("stock.create")}
          onClick={() => setCreating(true)}
        >
          <Plus size={19} /> Receive drug
        </button>
        <button
          className="cancel-button"
          onClick={() => setLocation("Unassigned")}
        >
          Unassigned (
          {data.items.filter((item) => item.status === "unassigned").length})
        </button>
        <form
          className="record-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (lookup.length === 8) {
              setQr(false);
              setHistory(lookup);
            }
          }}
        >
          <label className="visually-hidden" htmlFor="record-code">
            Find item by tracking code
          </label>
          <ClearInput
            id="record-code"
            placeholder="8-character code"
            pattern="[A-Za-z0-9]{8}"
            minLength={8}
            maxLength={8}
            required
            value={lookup}
            onChange={(event) => setLookup(event.target.value.toUpperCase())}
          />
          <button className="icon-button" aria-label="Find item record">
            <Search size={20} />
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <p role="status" className="inventory-status">
        {notice}
      </p>
      <StorageBrowser
        allowUnassigned
        showChecks
        renderCheckControls={(box, check) =>
          box.id === "unassigned" ? null : (
            <CheckControls
              key={check?.draft?.id || box.id}
              box={box}
              check={check}
              busy={busy}
              onAction={onCheckAction}
            />
          )
        }
        data={data}
        location={location}
        onLocationChange={setLocation}
        renderItem={(item) => (
          <>
            <label className="verify-control">
              <ClearInput
                type="checkbox"
                checked={
                  pendingVerification?.id === item.id
                    ? pendingVerification.value
                    : data.checks
                        .find((check) => check.boxId === item.box_id)
                        ?.checkedIds.includes(item.id) || false
                }
                disabled={
                  busy ||
                  !can("checks.verify") ||
                  !canDrug(drugFor(item), "check") ||
                  !data.checks.find((check) => check.boxId === item.box_id)
                    ?.draft
                }
                onChange={() => verify(item)}
                aria-label={"Verify " + item.code}
              />
              <span>
                <strong>{item.medication}</strong>
                <small>
                  {item.presentation}
                  {item.status === "opened" ? " · Opened" : ""}
                </small>
                <small className="item-id">
                  <code>{item.code}</code> ·{" "}
                  {item.status === "unassigned"
                    ? "Unassigned"
                    : (
                          pendingVerification?.id === item.id
                            ? pendingVerification.value
                            : data.checks
                                .find((check) => check.boxId === item.box_id)
                                ?.checkedIds.includes(item.id)
                        )
                      ? "Checked"
                      : "Not checked"}
                </small>
                {item.lot_number && (
                  <small>
                    Lot {item.lot_number} · Expires {item.expires_on}
                  </small>
                )}
              </span>
            </label>
            <div className="item-actions">
              <button
                className="icon-button"
                disabled={!can("records.view")}
                aria-label={"QR label " + item.code}
                onClick={() => {
                  setQr(true);
                  setHistory(item.code);
                }}
              >
                <QrCode size={19} />
              </button>
              <button
                className="icon-button"
                disabled={!can("records.view")}
                aria-label={"Record " + item.code}
                onClick={() => {
                  setQr(false);
                  setHistory(item.code);
                }}
              >
                <HistoryIcon size={19} />
              </button>
              <button
                className="move-button"
                disabled={
                  busy ||
                  !can("inventory.transfer") ||
                  !canDrug(drugFor(item), "transfer")
                }
                aria-label={"Move " + item.code}
                onClick={() => setMoving(item)}
              >
                <ArrowRightLeft size={17} />
                <span>Move</span>
              </button>
            </div>
          </>
        )}
      />
      {moving && (
        <MoveItem
          item={moving}
          data={data}
          onClose={() => setMoving(null)}
          onSaved={(result) => {
            setData(result);
            setNotice(moving.code + " moved. Verify it in its new container.");
          }}
        />
      )}
      {creating && (
        <NewDrug
          onManage={onManage}
          data={data}
          location={location}
          onClose={() => setCreating(false)}
          onSaved={(result) => {
            setData(result);
            setNotice(
              "Batch created as Unassigned. Transfer items to their containers.",
            );
            setLocation("Unassigned");
          }}
        />
      )}
      {history && (
        <History
          showQr={qr}
          identity={history}
          boxes={data.boxes}
          onClose={() => setHistory("")}
        />
      )}
    </section>
  );
}
