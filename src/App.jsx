import { useEffect, useState } from "react";

import {
  Home,
  Check,
  Syringe,
  ClipboardList,
  Plus,
  SlidersHorizontal,
  Tags,
  LayoutGrid,
  PackagePlus,
  FolderOpen,
  ArrowLeft,
  ScrollText,
  ShieldCheck,
  Layers,
  Users as UsersIcon,
  Building2,
  UserRound,
  ScanLine,
} from "lucide-react";

import "./App.css";
import ScanQR from "./ScanQR.jsx";
import WitnessPrompt from "./WitnessPrompt.jsx";

import Inventory from "./Inventory.jsx";

import Incident from "./Incident.jsx";

import Settings from "./Settings.jsx";

import ContainerDesigner from "./ContainerDesigner.jsx";

import Logs from "./Logs.jsx";

import Policies from "./Policies.jsx";

import Classes from "./Classes.jsx";

import { Users, Services, Account } from "./Accounts.jsx";

import { request } from "./api.js";

import { AccessProvider } from "./AccessContext.jsx";

import { useAccess } from "./access-state.js";

import { SearchSelect } from "./FormControls.jsx";

const pages = [
  { id: "home", label: "Home", icon: Home },
  { id: "inventory", label: "Inventory", icon: Check },
  { id: "use", label: "Use Medication", icon: Syringe },
  { id: "incident", label: "Incident", icon: ClipboardList },
];

const actions = [
  { id: "scan", label: "Scan QR", icon: ScanLine, permission: "records.view" },
  { id: "users", label: "Users", icon: UsersIcon, permission: "users.view" },
  {
    id: "services",
    label: "Services / DEA",
    icon: Building2,
    permission: "services.view",
  },
  {
    id: "account",
    label: "My Account",
    icon: UserRound,
    permission: "account.view",
  },
  {
    id: "inventory",
    label: "Drug Checks",
    icon: Check,
    permission: "inventory.view",
  },
  {
    id: "use",
    label: "Use Medication",
    icon: Syringe,
    permission: "medications.administer",
  },
  {
    id: "incidents",
    label: "Incidents",
    icon: FolderOpen,
    permission: "incidents.view",
  },
  {
    id: "receive",
    label: "Create Batch / Receive Stock",
    icon: PackagePlus,
    permission: "stock.create",
  },
  {
    id: "pars",
    label: "Manage Par Levels",
    icon: SlidersHorizontal,
    permission: "definitions.view",
  },
  { id: "tags", label: "Medication Tags", icon: Tags, permission: "tags.view" },
  {
    id: "designer",
    label: "Container / Storage Designer",
    icon: LayoutGrid,
    permission: "containers.view",
  },
  { id: "logs", label: "Logs", icon: ScrollText, permission: "logs.view" },
  {
    id: "classes",
    label: "Medication Classes",
    icon: Layers,
    permission: "classes.view",
  },
  {
    id: "policies",
    label: "Access Policies",
    icon: ShieldCheck,
    permission: "policies.view",
  },
];

function Workspace() {
  const { access, error, refresh, can, selectService, logout, profileId } =
      useAccess(),
    [route, setRoute] = useState(["home"]);

  const [services, setServices] = useState([]),
    [headerError, setHeaderError] = useState("");

  useEffect(() => {
    if (access)
      request("services")
        .then((data) => setServices(data.services))
        .catch((e) => setHeaderError(e.message));
  }, [access]);

  const page = route.at(-1),
    go = (next) =>
      setRoute((current) =>
        current.at(-1) === next ? current : [...current, next],
      ),
    home = () => setRoute(["home"]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, profileId]);

  const title =
    actions.find((action) => action.id === page)?.label ||
    pages.find((item) => item.id === page)?.label;

  const pagePermission =
    actions.find((action) => action.id === page)?.permission ||
    (page === "incident" ? "incidents.view" : "home.view");

  async function service(id) {
    if (!id) return;
    try {
      await selectService(id);
      home();
    } catch (e) {
      setHeaderError(e.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <a
            className="brand"
            href="#home"
            onClick={home}
            aria-label="EMCore Inventory home"
          >
            <span className="brand-mark">
              <Plus size={25} strokeWidth={3} />
            </span>
            <span>
              EMCore<span className="brand-subtitle">INVENTORY</span>
            </span>
          </a>
          {access && (
            <div className="profile-switch">
              <label htmlFor="active-service">{access.user.name}</label>
              <SearchSelect
                id="active-service"
                aria-label="Active service"
                value={access.user.serviceId}
                onChange={(event) => service(event.target.value)}
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </SearchSelect>
              <button className="header-signout" onClick={logout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main
        id="main"
        className="container page-content"
        key={profileId + ":" + page}
      >
        {!access ? (
          <p role="status">
            {error || "Loading account…"}
            {error && (
              <button className="cancel-button" onClick={refresh}>
                Retry
              </button>
            )}
          </p>
        ) : page === "home" ? (
          <>
            <div className="quick-action-grid">
              {!can("home.view") ? (
                <p role="alert">Home access is disabled for your account.</p>
              ) : (
                actions.map(({ id, label, icon: Icon, permission }) => (
                  <button
                    key={id}
                    disabled={!can(permission)}
                    title={
                      !can(permission) ? "Not allowed for your account" : label
                    }
                    onClick={() => go(id)}
                  >
                    <Icon size={36} strokeWidth={1.8} />
                    <span>{label}</span>
                  </button>
                ))
              )}
            </div>
            {headerError && (
              <p role="alert" className="error-note">
                {headerError}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="page-title-row">
              <button
                className="back-button"
                aria-label="Back"
                title="Back"
                onClick={() =>
                  setRoute((current) =>
                    current.length > 1 ? current.slice(0, -1) : ["home"],
                  )
                }
              >
                <ArrowLeft size={23} />
              </button>
              <h1>{title}</h1>
            </div>
            {!can(pagePermission) ? (
              <p className="error-note" role="alert">
                Your account cannot view this page.
              </p>
            ) : ["pars", "tags"].includes(page) ? (
              <Settings section={page} onHome={home} />
            ) : page === "designer" ? (
              <ContainerDesigner />
            ) : page === "logs" ? (
              <Logs />
            ) : page === "policies" ? (
              <Policies />
            ) : page === "classes" ? (
              <Classes />
            ) : page === "users" ? (
              <Users />
            ) : page === "services" ? (
              <Services />
            ) : page === "account" ? (
              <Account />
            ) : page === "scan" ? (
              <ScanQR />
            ) : ["inventory", "receive"].includes(page) ? (
              <Inventory
                onScan={() => go("scan")}
                initialReceive={page === "receive"}
                onManage={() => go("pars")}
              />
            ) : (
              <Incident
                defaultReason={page === "use" ? "used" : ""}
                initialTab={page === "incidents" ? "list" : "editor"}
              />
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <nav aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => {
            const active =
              id === page ||
              (id === "home" &&
                [
                  "pars",
                  "tags",
                  "designer",
                  "logs",
                  "policies",
                  "classes",
                  "users",
                  "services",
                  "account",
                ].includes(page)) ||
              (id === "inventory" && page === "receive") ||
              (id === "incident" && page === "incidents");
            const allowed =
              id === "home" ||
              can(
                id === "inventory"
                  ? "inventory.view"
                  : id === "use"
                    ? "medications.administer"
                    : "incidents.view",
              );
            return (
              <button
                key={id}
                disabled={!allowed}
                className={"nav-item " + (active ? "active" : "")}
                onClick={() => (id === "home" ? home() : go(id))}
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-circle">
                  <Icon size={24} />
                </span>
                <span className="nav-label">{label}</span>
              </button>
            );
          })}
        </nav>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AccessProvider>
      <Workspace />
      <WitnessPrompt />
    </AccessProvider>
  );
}
