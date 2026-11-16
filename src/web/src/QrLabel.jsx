import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { request } from "./api.js";
export default function QrLabel({ identity }) {
  const [label, setLabel] = useState(null),
    [image, setImage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request("qr?item=" + encodeURIComponent(identity))
      .then(async (data) => {
        const png = await QRCode.toDataURL(data.value, {
          width: 512,
          margin: 4,
          errorCorrectionLevel: "M",
        });
        if (active) {
          setLabel(data);
          setImage(png);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [identity]);
  return (
    <section className="qr-label" aria-label="Vial QR label">
      {error ? (
        <p role="alert" className="error-note">
          {error}
        </p>
      ) : !label ? (
        <p role="status">Generating QR label…</p>
      ) : (
        <>
          <img
            src={image}
            width="240"
            height="240"
            alt={"QR code for vial " + label.item.code}
          />
          <strong>{label.item.medication}</strong>
          <span>{label.item.presentation}</span>
          <code>{label.item.code}</code>
          <small>{label.serviceName}</small>
          {label.item.lot_number && (
            <small>
              Lot {label.item.lot_number} · Exp {label.item.expires_on}
            </small>
          )}
          <a
            className="cancel-button"
            href={"/api/qr/image?item=" + encodeURIComponent(label.item.code)}
            download={"EMCore-" + label.item.code + ".png"}
          >
            Download QR PNG
          </a>
          <p className="field-help">
            One label identifies this individual vial. Scan in EMCore to open
            its record.
          </p>
        </>
      )}
    </section>
  );
}
