"use client";

// The client filter on the job list: picking one applies it straight away.
export function ClientSelect({ clients, value }: { clients: string[]; value: string }) {
  return (
    <select
      name="client"
      defaultValue={value}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      aria-label="Client"
      className="max-w-[16rem] rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
    >
      <option value="">All clients</option>
      {clients.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
