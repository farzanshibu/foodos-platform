/**
 * SOT: project-list-ui, optimistic-projects, project-create-form
 * WHAT   Project list with optimistic create.
 * WHY    Both halves of the mirror in one file: <Gate> decides whether the control exists,
 *        and <UpgradePrompt> renders the platform's own denial if the plan is the blocker.
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { EmptyState } from "@foodos/ui/empty-state";
import { Gate, useAccess } from "@foodos/ui/gate";
import { Input } from "@foodos/ui/input";
import { UpgradePrompt } from "@foodos/ui/upgrade-prompt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useState } from "react";

import { slugify } from "@/features/projects/rules";
import { useTRPC } from "@/trpc/react";

type Project = OutputOf<"project", "read">["items"][number];

export function ProjectList({ initialItems }: { initialItems: Project[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const projects = useQuery(
    trpc.project.list.queryOptions(
      { limit: 20, includeArchived: false },
      { initialData: { items: initialItems, nextCursor: null } },
    ),
  );

  const create = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: () => {
        setName("");
        void queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
      },
    }),
  );

  const access = useAccess("project", "create");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="space-y-1">
          <h1 className="font-semibold text-foreground text-xl tracking-[-0.015em]">Projects</h1>
          <p className="text-muted-foreground text-sm">
            Every workspace your organisation runs, and what each one is called.
          </p>
        </div>
        <Gate
          resource="project"
          operation="create"
          fallback={access.decision.allowed ? null : <UpgradePrompt decision={access.decision} />}
        >
          {/* A two-field form is a row, not a modal: the create is one keystroke away
              from the list it changes. */}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.length >= 2) create.mutate({ name, slug: slugify(name) });
            }}
          >
            <label className="sr-only" htmlFor="new-project">
              New project name
            </label>
            <Input
              id="new-project"
              placeholder="New project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-52"
            />
            <Button type="submit" disabled={name.length < 2} loading={create.isPending}>
              Create project
            </Button>
          </form>
        </Gate>
      </header>

      <Denial error={create.error} resource="project" />

      {projects.data.items.length === 0 ? (
        <EmptyState
          icon={<FolderPlus />}
          title="No projects yet"
          detail="A project is where a site's menus, orders and staff live. Name the first one above and everything else hangs off it."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {projects.data.items.map((project) => (
                <li
                  key={project.id}
                  className="flex items-baseline justify-between gap-4 px-4 py-3 transition-colors duration-150 hover:bg-surface"
                >
                  <p className="truncate font-medium text-sm">{project.name}</p>
                  <p className="shrink-0 font-mono text-muted-foreground text-xs">
                    /{project.slug}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
