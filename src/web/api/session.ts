import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { sessionQueryKey } from "./query-keys";

export function useSessionUserId(): string {
  const sessionQuery = useQuery({ queryKey: sessionQueryKey, queryFn: api.session });
  return sessionQuery.data?.user.id ?? "pending";
}
