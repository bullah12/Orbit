import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { getProfile, getToday, listSpaces, listTasks, toggleTask, type TaskFilter, updateProfile, updateTask } from './api';
import { queryKeys } from './queryKeys';
import type { Profile, Task } from './types';

export function useProfile() {
  const { user } = useAuth();
  return useQuery({ queryKey: queryKeys.profile(user?.id ?? ''), queryFn: () => getProfile(user!.id), enabled: Boolean(user), staleTime: 5 * 60_000 });
}

export function useSpaces() {
  return useQuery({ queryKey: queryKeys.spaces, queryFn: listSpaces, staleTime: 5 * 60_000 });
}

export function useTasks(filter: TaskFilter, space = '', assignee = '') {
  const { user } = useAuth();
  return useQuery({ queryKey: queryKeys.tasks(filter, space, assignee), queryFn: () => listTasks(filter, space, assignee, user?.id ?? ''), enabled: Boolean(user), placeholderData: (previous) => previous });
}

export function useToday(range: number) {
  return useQuery({ queryKey: queryKeys.today(range), queryFn: () => getToday(range), placeholderData: (previous) => previous });
}

export function useToggleTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: toggleTask,
    onMutate: async (task) => {
      await client.cancelQueries({ queryKey: ['tasks'] });
      await client.cancelQueries({ queryKey: ['today'] });
      const snapshots = client.getQueriesData<Task[]>({ queryKey: ['tasks'] });
      const todaySnapshots = client.getQueriesData<{ tasks: Task[] }>({ queryKey: ['today'] });
      const optimistic = { ...task, status: task.status === 'done' ? 'todo' : 'done', completed_at: task.status === 'done' ? null : new Date().toISOString() } as Task;
      for (const [key, rows] of snapshots) client.setQueryData(key, rows?.map((row) => row.id === task.id ? optimistic : row));
      for (const [key, data] of todaySnapshots) client.setQueryData(key, data ? { ...data, tasks: data.tasks.map((row) => row.id === task.id ? optimistic : row) } : data);
      return { snapshots, todaySnapshots };
    },
    onError: (_error, _task, context) => {
      for (const [key, data] of context?.snapshots ?? []) client.setQueryData(key, data);
      for (const [key, data] of context?.todaySnapshots ?? []) client.setQueryData(key, data);
    },
    onSettled: (_data, _error, task) => {
      void client.invalidateQueries({ queryKey: ['today'] });
      for (const [key] of client.getQueriesData({ queryKey: ['tasks'] })) {
        if (key.includes(task.id)) continue;
        void client.invalidateQueries({ queryKey: key, exact: true });
      }
      client.setQueryData(queryKeys.task(task.id), (old: { task: Task } | undefined) => old ? { ...old, task: _data ?? old.task } : old);
    },
  });
}

export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<Task> }) => updateTask(id, changes),
    onSuccess: (task) => {
      client.setQueryData(queryKeys.task(task.id), (old: object | undefined) => old ? { ...old, task } : { task, checklist: [] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Profile>) => updateProfile(user!.id, changes),
    onSuccess: (profile) => client.setQueryData(queryKeys.profile(profile.id), profile),
  });
}
