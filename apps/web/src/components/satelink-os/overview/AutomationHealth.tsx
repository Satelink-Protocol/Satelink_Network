import React from 'react';
import { DataTable, type Column } from '../tables/DataTable';
import { StatusDot } from '../badges/StatusDot';

export interface Job {
  job_name: string;
  action?: string;
  created_at?: string;
}

export interface AutomationHealthProps {
  jobs: Job[] | null;
  jobsErr?: string | null;
  jobDotTone: (j: Job) => 'success' | 'warn' | 'danger' | 'muted';
}

const fmt = {
  time: (t?: string) => {
    if (!t) return "—";
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
  },
};

export function AutomationHealth({ jobs, jobsErr, jobDotTone }: AutomationHealthProps): JSX.Element {
  const healthColumns: Column<Job>[] = [
    { key: "dot", header: "", render: (j) => <StatusDot tone={jobDotTone(j)} pulse={jobDotTone(j) === "success"} /> },
    { key: "job_name", header: "Job", mono: true },
    { key: "created_at", header: "Last run", mono: true, muted: true, render: (j) => fmt.time(j.created_at) },
  ];

  return (
    <DataTable
      columns={healthColumns}
      rows={jobs}
      getRowKey={(j, i) => `${j.job_name}-${i}`}
      error={jobsErr}
      emptyLabel="automation jobs"
      emptyMessage="No job history yet"
      emptyNote="trigger a job in Agents"
    />
  );
}
