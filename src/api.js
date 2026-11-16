import { askWitness } from "./witness-prompt.js";
import { useEffect, useState } from "react";

export function getProfileId() {
  try {
    return sessionStorage.getItem("emcore-user-scope") || "signed-out";
  } catch {
    return "signed-out";
  }
}
export async function request(path, body) {
  let payload = body;
  for (;;) {
    const response = await fetch("/api/" + path, {
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "EMCore",
      },
      ...(payload ? { method: "POST", body: JSON.stringify(payload) } : {}),
    });
    if (payload?.witnessCredentials)
      payload = { ...payload, witnessCredentials: undefined };
    const data = await response.json();
    if (!response.ok && data.witnessRequired) {
      const credentials = await askWitness({
        message: data.error,
        summary: data.witnessSummary,
      });
      if (!credentials)
        throw new Error("Witness sign-off cancelled. No changes were saved.");
      payload = { ...body, witnessCredentials: credentials };
      continue;
    }
    if (response.status === 401 && !path.startsWith("auth/"))
      window.dispatchEvent(new Event("emcore-session-expired"));
    if (!response.ok)
      throw Object.assign(
        new Error(data.error || "Unable to load inventory"),
        data,
      );
    if (path === "access" && data.user) {
      try {
        sessionStorage.setItem(
          "emcore-user-scope",
          data.user.id + ":" + data.user.serviceId,
        );
      } catch {}
    }
    return data;
  }
}

export function useInventory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      request("inventory")
        .then((result) => {
          if (active) {
            setData(result);
            setError("");
          }
        })
        .catch((error) => {
          if (active)
            setError(
              error.message ||
                "Cannot reach inventory. Make sure npm run dev is running.",
            );
        });
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function reload() {
    try {
      setData(await request("inventory"));
      setError("");
    } catch {
      setError("Cannot reach inventory. Make sure npm run dev is running.");
    }
  }
  return { data, setData, error, setError, reload };
}

export const confirmedSeals = (boxes) =>
  boxes.map((box) => ({ id: box.id, seal: box.seal }));
