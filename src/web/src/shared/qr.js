export function qrValue(serviceId, item) {
  return `EMCORE:1:${serviceId}:${item.id}:${item.code}`;
}
export function parseQr(value) {
  if (typeof value !== "string" || value.length > 300)
    throw new Error(
      "Enter an EMCore vial QR code or eight-character tracking code",
    );
  const input = value.trim();
  if (/^[a-z0-9]{8}$/i.test(input)) return { code: input.toUpperCase() };
  const match =
    /^EMCORE:1:([a-zA-Z0-9-]{1,80}):([a-zA-Z0-9-]{1,80}):([A-Z0-9]{8})$/.exec(
      input,
    );
  if (!match) throw new Error("This is not a supported EMCore vial QR code");
  return { serviceId: match[1], itemId: match[2], code: match[3] };
}
