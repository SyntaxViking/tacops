import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { getSafeMowRow } from "../mow/mow-view-model";
import type { RawUnit } from "../api/types";

const cellClass = "border-b border-black/10 px-3 py-2 align-top dark:border-white/15";

export function MowTable({ machinesOfWar }: { machinesOfWar: RawUnit[] }) {
  if (machinesOfWar.length === 0) {
    return <p>No machines of war found.</p>;
  }

  const sortedMachinesOfWar = [...machinesOfWar].sort((a, b) => (b.power ?? -Infinity) - (a.power ?? -Infinity));

  return (
    <table className="mt-4 w-full table-auto border-collapse text-left">
      <thead>
        <tr>
          <th className={cellClass}>Machine of War</th>
          <th className={cellClass}>Portrait</th>
          <th className={cellClass}>Faction</th>
          <th className={cellClass}>Rarity</th>
          <th className={cellClass}>Stars</th>
          <th className={cellClass}>Active</th>
          <th className={cellClass}>Passive</th>
          <th className={cellClass}>Power</th>
        </tr>
      </thead>
      <tbody>
        {sortedMachinesOfWar.map((mow) => {
          const row = getSafeMowRow(mow, "mows");
          if (!row) return null;
          return (
            <tr key={row.id}>
              <td className={cellClass}>{row.name}</td>
              <td className={cellClass}>
                <Icon src={row.portraitUrl} title={row.id} />
              </td>
              <td className={cellClass}>{row.factionIconUrl ? <Icon src={row.factionIconUrl} /> : row.faction}</td>
              <td className={cellClass}>
                <Icon src={row.rarityIconUrl} />
              </td>
              <td className={cellClass}>
                <IconRow>
                  {row.starIconUrls.map((url, i) => (
                    <Icon key={i} src={url} />
                  ))}
                </IconRow>
              </td>
              <td className={cellClass}>{row.activeLevel}</td>
              <td className={cellClass}>{row.passiveLevel}</td>
              <td className={cellClass}>{row.power?.toLocaleString() ?? "unknown"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
