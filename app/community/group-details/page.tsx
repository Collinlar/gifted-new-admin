"use client";

import { useEffect, useState, useRef } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Users, MessageSquare, RefreshCw } from "lucide-react";

interface Group {
  _id: string;
  mongoId?: string;
  name?: string;
  title?: string;
  description?: string;
  members?: { _id: string; firstName?: string; lastName?: string; name?: string; email?: string }[];
  channels?: Channel[];
}

interface Channel {
  _id: string;
  name?: string;
  title?: string;
  description?: string;
}

interface Message {
  _id: string;
  sender?: string;
  senderName?: string;
  name?: string;
  text?: string;
  message?: string;
  content?: string;
  attachment?: string;
  createdAt?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export default function GroupDetailsPage() {
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [tab, setTab] = useState<"members" | "messages">("members");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("group");
    const id = localStorage.getItem("groupId");
    if (!stored || !id) { router.push("/community"); return; }
    setGroup(JSON.parse(stored));
  }, [router]);

  const loadMessages = async (g: Group) => {
    // messages.channel_id = groups.mongo_id (the MongoDB ObjectId)
    const channelId = g.mongoId || g._id;
    setLoadingMessages(true);
    try {
      const res = await api.get(`/channel-feed/${channelId}`);
      const raw = res.data.messages || res.data.feed || res.data || [];
      setMessages(Array.isArray(raw) ? raw : []);
      setMessagesLoaded(true);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  useEffect(() => {
    if (tab === "messages" && group && !messagesLoaded) {
      loadMessages(group);
    }
  }, [tab, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteMessage = async (msgId: string) => {
    if (!confirm("Delete this message?")) return;
    try {
      await api.delete(`/delete-message/${msgId}`);
      setMessages((prev) => prev.filter((m) => m._id !== msgId));
    } catch {
      alert("Could not delete message.");
    }
  };

  const getMsgText = (m: Message) => m.text || m.message || m.content || "";
  const getMsgSender = (m: Message) => m.senderName || m.name || m.sender || "Unknown";
  const getMsgTime = (m: Message) => {
    const t = m.createdAt || m.timestamp;
    return t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  };

  if (!group) return null;

  const members = group.members || [];
  const channels = group.channels || [];

  return (
    <AuthGuard>
      <DashboardShell title={group.name || group.title || "Group"}>
        <div className="space-y-5 max-w-4xl">
          <Button variant="ghost" size="sm" onClick={() => router.push("/community")}>
            <ArrowLeft size={14} /> Back to communities
          </Button>

          {/* Group summary */}
          <div className="bg-card border border-border rounded-xl p-5 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
              <Users size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-ink text-base">{group.name || group.title}</h2>
              {group.description && <p className="text-sm text-muted mt-0.5">{group.description}</p>}
              <div className="flex items-center gap-4 mt-2 text-xs text-subtle">
                <span>{members.length} member{members.length !== 1 ? "s" : ""}</span>
                <span>{channels.length} channel{channels.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
            <button onClick={() => setTab("members")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "members" ? "bg-primary text-white shadow-sm" : "text-muted hover:text-ink"}`}>
              Members ({members.length})
            </button>
            <button onClick={() => setTab("messages")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "messages" ? "bg-primary text-white shadow-sm" : "text-muted hover:text-ink"}`}>
              Messages {messagesLoaded ? `(${messages.length})` : ""}
            </button>
          </div>

          {tab === "members" && (
            <Card padding={false} title="Members">
              {members.length === 0 ? (
                <p className="text-sm text-muted px-5 py-8 text-center">No members yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-5 py-3 text-muted font-medium">Name</th>
                      <th className="text-left px-5 py-3 text-muted font-medium">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m._id} className="border-b border-border last:border-0 hover:bg-surface/40">
                        <td className="px-5 py-3 font-medium text-ink">
                          {m.name || `${m.firstName || ""} ${m.lastName || ""}`.trim() || "—"}
                        </td>
                        <td className="px-5 py-3 text-muted">{m.email || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === "messages" && (
            <Card padding={false}
              title={`${messages.length} message${messages.length !== 1 ? "s" : ""}`}
              action={
                group && (
                  <button onClick={() => { setMessagesLoaded(false); loadMessages(group); }}
                    className="p-1.5 rounded-lg text-subtle hover:text-ink transition-colors">
                    <RefreshCw size={13} />
                  </button>
                )
              }
            >
              <div className="h-[520px] overflow-y-auto px-4 py-4 space-y-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner text="Loading messages..." />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-muted text-sm">No messages in this group yet.</p>
                  </div>
                ) : (
                  messages.map((m) => (
                    <div key={m._id} className="group flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                        {getMsgSender(m).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-ink">{getMsgSender(m)}</span>
                          <span className="text-xs text-subtle">{getMsgTime(m)}</span>
                        </div>
                        <p className="text-sm text-body break-words">{getMsgText(m)}</p>
                        {m.attachment && (
                          <a href={m.attachment} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline">
                            <MessageSquare size={11} /> View attachment
                          </a>
                        )}
                      </div>
                      <button
                        onClick={() => deleteMessage(m._id)}
                        className="p-1 rounded text-subtle hover:text-danger opacity-0 group-hover:opacity-100 transition-all shrink-0 mt-0.5"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            </Card>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
