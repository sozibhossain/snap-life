import React, { useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronRight,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  UserCircle,
} from "lucide-react";

import { AdminLayout } from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ChatListItem {
  id: number;
  requestId: string;
  appUserId: string;
  email: string | null;
  displayName: string | null;
  role: "user" | "assistant" | string;
  content: string;
  promptKey: string;
  promptVersion: number | null;
  createdAt: string | null;
}

interface ChatListResponse {
  items: ChatListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface ChatUserSummary {
  appUserId: string;
  email: string | null;
  displayName: string | null;
  latestMessage: ChatListItem;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
}

const USER_SCAN_LIMIT = 500;
const THREAD_LIMIT = 500;

function fmtRelative(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${formatDistanceToNow(d)} ago`;
}

function fmtExact(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "MMM d, yyyy HH:mm");
}

function userLabel(user: {
  displayName: string | null;
  email: string | null;
  appUserId: string;
}): string {
  return user.displayName || user.email || user.appUserId;
}

function initialFor(user: ChatUserSummary): string {
  return userLabel(user).charAt(0).toUpperCase() || "U";
}

async function fetchChats(params: {
  getToken: () => Promise<string | null>;
  search?: string;
  appUserId?: string;
  limit: number;
}): Promise<ChatListResponse> {
  const qs = new URLSearchParams({
    limit: String(params.limit),
    offset: "0",
  });
  if (params.search) qs.set("search", params.search);
  if (params.appUserId) qs.set("appUserId", params.appUserId);

  const token = await params.getToken();
  const res = await fetch(`/api/admin/chats?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ChatListResponse;
}

function buildUserSummaries(items: ChatListItem[]): ChatUserSummary[] {
  const byUser = new Map<string, ChatUserSummary>();

  for (const item of items) {
    const existing = byUser.get(item.appUserId);
    if (!existing) {
      byUser.set(item.appUserId, {
        appUserId: item.appUserId,
        email: item.email,
        displayName: item.displayName,
        latestMessage: item,
        messageCount: 1,
        userMessageCount: item.role === "user" ? 1 : 0,
        assistantMessageCount: item.role === "assistant" ? 1 : 0,
      });
      continue;
    }

    existing.messageCount += 1;
    existing.userMessageCount += item.role === "user" ? 1 : 0;
    existing.assistantMessageCount += item.role === "assistant" ? 1 : 0;
    if (!existing.email && item.email) existing.email = item.email;
    if (!existing.displayName && item.displayName) {
      existing.displayName = item.displayName;
    }

    const currentMs = existing.latestMessage.createdAt
      ? new Date(existing.latestMessage.createdAt).getTime()
      : 0;
    const itemMs = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    if (itemMs > currentMs) existing.latestMessage = item;
  }

  return [...byUser.values()].sort((a, b) => {
    const av = a.latestMessage.createdAt
      ? new Date(a.latestMessage.createdAt).getTime()
      : 0;
    const bv = b.latestMessage.createdAt
      ? new Date(b.latestMessage.createdAt).getTime()
      : 0;
    return bv - av;
  });
}

export default function Chats() {
  const { getToken } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<ChatUserSummary | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-chat-users", { search }],
    queryFn: async () =>
      fetchChats({
        getToken,
        search,
        limit: USER_SCAN_LIMIT,
      }),
  });

  const summaries = useMemo(
    () => buildUserSummaries(usersQuery.data?.items ?? []),
    [usersQuery.data?.items],
  );

  const selectedChatsQuery = useQuery({
    queryKey: ["admin-chat-thread", selectedUser?.appUserId],
    enabled: selectedUser !== null,
    queryFn: async () =>
      fetchChats({
        getToken,
        appUserId: selectedUser!.appUserId,
        limit: THREAD_LIMIT,
      }),
  });

  const thread = useMemo(() => {
    return [...(selectedChatsQuery.data?.items ?? [])].sort((a, b) => {
      const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return av - bv;
    });
  }, [selectedChatsQuery.data?.items]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Chats
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review Bone Buddy conversations by user.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCircle className="h-4 w-4 text-primary" />
              Users
              {summaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {summaries.length}
                </Badge>
              )}
            </CardTitle>
            <form
              onSubmit={handleSearch}
              className="flex flex-col sm:flex-row gap-2 pt-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search user id or message content..."
                  className="pl-9 bg-background"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
              {search && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setSearchInput("");
                  }}
                >
                  Clear
                </Button>
              )}
            </form>
          </CardHeader>
          <CardContent className="p-0">
            {usersQuery.isError ? (
              <div className="p-6 flex flex-col items-start gap-3">
                <p className="text-sm text-destructive">
                  Failed to load chat users.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => usersQuery.refetch()}
                  disabled={usersQuery.isFetching}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${usersQuery.isFetching ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  Retry
                </Button>
              </div>
            ) : usersQuery.isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : summaries.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {search ? "No users match your search." : "No chats recorded yet."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="w-[140px] text-right">
                        Messages
                      </TableHead>
                      <TableHead>Latest</TableHead>
                      <TableHead className="w-[150px] whitespace-nowrap">
                        Last Chat
                      </TableHead>
                      <TableHead className="w-[70px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries.map((user) => (
                      <TableRow
                        key={user.appUserId}
                        className="cursor-pointer"
                        onClick={() => setSelectedUser(user)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3 min-w-[220px]">
                            <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
                              {initialFor(user)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {userLabel(user)}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {user.email || user.appUserId}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Badge variant="outline">
                              {user.userMessageCount} user
                            </Badge>
                            <Badge variant="secondary">
                              {user.assistantMessageCount} AI
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="max-w-[520px] truncate text-sm">
                            {user.latestMessage.content}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtRelative(user.latestMessage.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            aria-label={`Open chats for ${userLabel(user)}`}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={selectedUser !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedUser(null);
        }}
      >
        <DialogContent className="max-w-4xl h-[86vh] grid-rows-[auto_1fr] p-0 gap-0 overflow-hidden">
          {selectedUser && (
            <>
              <DialogHeader className="px-5 py-4 border-b bg-card">
                <div className="flex items-center gap-3 pr-8">
                  <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
                    {initialFor(selectedUser)}
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="truncate">
                      {userLabel(selectedUser)}
                    </DialogTitle>
                    <DialogDescription className="truncate">
                      {selectedUser.email || selectedUser.appUserId}
                    </DialogDescription>
                  </div>
                  <Badge variant="secondary" className="ml-auto shrink-0 gap-1">
                    <MessageSquareText className="h-3 w-3" />
                    {selectedChatsQuery.data?.total ?? selectedUser.messageCount}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto bg-muted/30 px-4 py-5">
                {selectedChatsQuery.isLoading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton
                        key={i}
                        className={cn(
                          "h-20 w-[72%]",
                          i % 2 === 0 ? "mr-auto" : "ml-auto",
                        )}
                      />
                    ))}
                  </div>
                ) : selectedChatsQuery.isError ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                    <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-destructive">
                      Failed to load this user's chats.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectedChatsQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : thread.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    No messages recorded for this user.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {thread.map((message) => {
                      const isUser = message.role === "user";
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "flex",
                            isUser ? "justify-end" : "justify-start",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[78%] rounded-lg px-4 py-3 shadow-sm border",
                              isUser
                                ? "bg-primary text-primary-foreground border-primary/20"
                                : "bg-card text-card-foreground border-border",
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <Badge
                                variant={isUser ? "secondary" : "outline"}
                                className="h-5 px-1.5 text-[10px] capitalize"
                              >
                                {isUser ? "User" : "Bone Buddy"}
                              </Badge>
                              <span
                                className={cn(
                                  "text-[11px]",
                                  isUser
                                    ? "text-primary-foreground/75"
                                    : "text-muted-foreground",
                                )}
                              >
                                {fmtExact(message.createdAt)}
                              </span>
                            </div>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                              {message.content}
                            </p>
                            <p
                              className={cn(
                                "mt-2 text-[10px] font-mono truncate",
                                isUser
                                  ? "text-primary-foreground/65"
                                  : "text-muted-foreground",
                              )}
                            >
                              {message.requestId}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
