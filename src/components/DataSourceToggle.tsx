import type { DevDataSource } from "../api/dev-data-source";

const SOURCES: { value: DevDataSource; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "production", label: "Production web app" },
];

interface DataSourceToggleProps {
  value: DevDataSource;
  onChange: (value: DevDataSource) => void;
}

// Tauri-only (see dev-data-source.ts) - rendered directly under EnvironmentToggle in App.tsx, same
// dev-mode gating. Lets testing happen against the deployed Worker's D1-backed data (planet
// history, crusade-cache, preferences) without the developer needing a local D1 running.
export function DataSourceToggle({ value, onChange }: DataSourceToggleProps) {
  return (
    <div className="my-2 flex justify-center gap-4">
      {SOURCES.map((source) => (
        <label key={source.value} className="flex cursor-pointer items-center gap-1">
          <input type="radio" name="devDataSource" checked={value === source.value} onChange={() => onChange(source.value)} />
          {source.label}
        </label>
      ))}
    </div>
  );
}
