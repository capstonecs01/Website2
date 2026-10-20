import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch, API_BASE_URL } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

// Turn bare URLs in a message into clickable links.
function renderBody(text) {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:opacity-80">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

const TAG_COLOR = {
  Project: "var(--signal)",
  Team: "var(--connect)",
  DM: "var(--text-muted)",
};

export default function Messages() {
  const user = useAuthUser();
  const { t, lang } = useLang();
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [tx, setTx] = useState({}); // message id -> translated text
  const [txBusy, setTxBusy] = useState(null);
  const [showOrig, setShowOrig] = useState(() => new Set());

  async function translateMsg(m) {
    setTxBusy(m.id);
    try {
      const d = await apiFetch("/chat/translate", { method: "POST", body: { text: m.body, target: lang } });
      setTx((prev) => ({ ...prev, [m.id]: d.text }));
    } catch (err) {
      setError(err.message);
    } finally {
      setTxBusy(null);
    }
  }
  function toggleOrig(id) {
    setShowOrig((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const [searchParams] = useSearchParams();

  const accent = user?.role === "company" ? "var(--signal)" : "var(--connect)";
  const tagLabel = (tag) => t("chat.tag" + tag);
  const subLabel = (s) =>
    s === "Company + team" ? t("chat.subAll") : s === "Students only" ? t("chat.subStudents") : s === "Student" ? t("common.studentWord") : s;

  // Deep-link: /messages?c=<id> opens a specific conversation (e.g. from a project page).
  useEffect(() => {
    const c = searchParams.get("c");
    if (c) setActiveId(Number(c));
  }, [searchParams]);

  const loadConversations = useCallback(() => {
    apiFetch("/chat/conversations")
      .then((d) => {
        setConversations(d.conversations);
        setActiveId((cur) => cur ?? d.conversations[0]?.id ?? null);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Initial load + poll the conversation list every 5s.
  useEffect(() => {
    if (!user) return;
    loadConversations();
    if (user.role === "student") {
      apiFetch("/chat/contacts").then((d) => setContacts(d.contacts)).catch(() => {});
    }
    const timer = setInterval(loadConversations, 5000);
    return () => clearInterval(timer);
  }, [user, loadConversations]);

  // Load + poll messages for the open conversation every 2.5s.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    const fetchMsgs = () =>
      apiFetch(`/chat/conversations/${activeId}/messages`)
        .then((d) => alive && setMessages(d.messages))
        .catch((err) => alive && setError(err.message));
    fetchMsgs();
    const timer = setInterval(fetchMsgs, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    if ((!text.trim() && !file) || sending) return;
    setSending(true);
    setError("");
    const form = new FormData();
    if (text.trim()) form.append("body", text.trim());
    if (file) form.append("file", file);
    try {
      const d = await apiFetch(`/chat/conversations/${activeId}/messages`, { method: "POST", body: form });
      setMessages((m) => [...m, d.message]);
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      loadConversations();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function startDm(contactId) {
    try {
      const d = await apiFetch("/chat/dm", { method: "POST", body: { userId: contactId } });
      setConversations((list) => (list.some((c) => c.id === d.conversation.id) ? list : [d.conversation, ...list]));
      setActiveId(d.conversation.id);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return null;
  const active = conversations.find((c) => c.id === activeId);

  return (
    <AppShell user={user}>
      <header className="mb-6">
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">{t("msg.title")}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {user.role === "student" ? t("msg.subtitleStudent") : t("msg.subtitleCompany")}
        </p>
      </header>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="grid h-[calc(100vh-220px)] grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
        {/* Conversation list */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]">
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="p-6 text-sm text-[var(--text-muted)]">{t("msg.noConvos")}</p>
            )}
            {conversations.map((c) => {
              const on = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className="flex w-full flex-col gap-1 border-b border-[var(--line)] px-4 py-3 text-left transition"
                  style={on ? { background: "color-mix(in srgb, " + accent + " 12%, transparent)" } : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-sm px-1.5 py-0.5 font-mono-display text-[9px] font-semibold uppercase tracking-wider"
                      style={{ color: TAG_COLOR[c.tag], border: `1px solid ${TAG_COLOR[c.tag]}` }}
                    >
                      {tagLabel(c.tag)}
                    </span>
                    <span className="truncate font-mono-display text-sm font-semibold">{c.title}</span>
                  </div>
                  <span className="truncate text-xs text-[var(--text-muted)]">
                    {c.lastMessage ? c.lastMessage.preview : subLabel(c.subtitle)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* DM starter (students only) */}
          {user.role === "student" && contacts.length > 0 && (
            <div className="border-t border-[var(--line)] p-3">
              <p className="mb-2 font-mono-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {t("msg.messageTeammate")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {contacts.map((ct) => (
                  <button
                    key={ct.id}
                    onClick={() => startDm(ct.id)}
                    className="rounded-full border border-[var(--line)] px-2.5 py-1 font-mono-display text-[11px] text-[var(--text-muted)] transition hover:border-[var(--connect)] hover:text-[var(--connect)]"
                  >
                    + {ct.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Thread */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]">
          {!active ? (
            <div className="grid flex-1 place-items-center text-sm text-[var(--text-muted)]">
              {t("msg.selectConvo")}
            </div>
          ) : (
            <>
              <div className="border-b border-[var(--line)] px-5 py-3">
                <p className="font-mono-display text-sm font-semibold">
                  {active.type === "dm" ? (
                    <Link
                      to={`/users/${active.members.find((m) => m.id !== user.id)?.id}`}
                      className="transition hover:underline underline-offset-2"
                    >
                      {active.title}
                    </Link>
                  ) : (
                    active.title
                  )}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {subLabel(active.subtitle)} ·{" "}
                  {active.members.map((m, i) => (
                    <span key={m.id}>
                      {i > 0 && ", "}
                      <Link to={`/users/${m.id}`} className="transition hover:text-[var(--text)] hover:underline underline-offset-2">
                        {m.name}
                      </Link>
                    </span>
                  ))}
                </p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {messages.map((m) => {
                  const mine = m.sender.id === user.id;
                  return (
                    <div key={m.id} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
                      {!mine && (
                        <span className="mb-0.5 font-mono-display text-[11px] text-[var(--text-muted)]">
                          <Link to={`/users/${m.sender.id}`} className="transition hover:text-[var(--text)] hover:underline underline-offset-2">
                            {m.sender.name}
                          </Link>
                          {m.sender.role === "company" && <span className="ml-1 text-[var(--signal)]">· {t("msg.company")}</span>}
                        </span>
                      )}
                      <div
                        className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
                        style={
                          mine
                            ? { background: accent, color: "#0E1116" }
                            : { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)" }
                        }
                      >
                        {m.attachment?.type === "image" && (
                          <a href={`${API_BASE_URL}${m.attachment.url}`} target="_blank" rel="noreferrer">
                            <img
                              src={`${API_BASE_URL}${m.attachment.url}`}
                              alt={m.attachment.name}
                              className="mb-1 max-h-60 rounded-lg"
                            />
                          </a>
                        )}
                        {m.attachment?.type === "file" && (
                          <a
                            href={`${API_BASE_URL}${m.attachment.url}`}
                            target="_blank"
                            rel="noreferrer"
                            download={m.attachment.name}
                            className="mb-1 flex items-center gap-2 underline underline-offset-2"
                          >
                            📎 {m.attachment.name}
                          </a>
                        )}
                        {m.body && (
                          <div className="whitespace-pre-wrap break-words">
                            {renderBody(tx[m.id] && !showOrig.has(m.id) ? tx[m.id] : m.body)}
                          </div>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono-display text-[10px] text-[var(--text-muted)]">
                        {m.body &&
                          (!tx[m.id] ? (
                            <button
                              onClick={() => translateMsg(m)}
                              disabled={txBusy === m.id}
                              className="transition hover:text-[var(--text)] disabled:opacity-60"
                            >
                              {txBusy === m.id ? t("chat.translating") : t("chat.translate")}
                            </button>
                          ) : (
                            <button onClick={() => toggleOrig(m.id)} className="transition hover:text-[var(--text)]">
                              {showOrig.has(m.id) ? t("chat.showTranslation") : t("chat.showOriginal")}
                            </button>
                          ))}
                        <span>
                          {new Date(m.createdAt + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <form onSubmit={send} className="border-t border-[var(--line)] p-3">
                {file && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span className="rounded-sm bg-[var(--bg)] px-2 py-1">📎 {file.name}</span>
                    <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} className="hover:text-[var(--text)]">
                      {t("msg.remove")}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    title={t("msg.attachTitle")}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-[var(--line)] text-[var(--text-muted)] transition hover:border-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 1 1 4.95 4.95L9.4 17.43a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49" />
                    </svg>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files[0] || null)}
                  />
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("msg.inputPh")}
                    className="flex-1 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-4 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--text-muted)]"
                  />
                  <button
                    type="submit"
                    disabled={sending || (!text.trim() && !file)}
                    className="rounded-sm px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-40"
                    style={{ background: accent }}
                  >
                    {sending ? "…" : t("msg.send")}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
