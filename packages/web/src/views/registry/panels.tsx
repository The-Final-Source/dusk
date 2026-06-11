/**
 * Registry skeleton panels — Phase 5 ecosystem skeleton (design D9; P5-T14 web
 * half). Pure presentational components over the registry router's data:
 * routable/renderable, NOT feature-complete — no pagination, no editing, no
 * live updates, no auth-surface changes (explicitly out of v1 scope).
 */

export type AdherenceIntentEntry = {
  path: string;
  description: string;
  obligation: string;
  total_aspects: number;
  unsatisfied_aspects: string[];
  satisfied: boolean;
  claimed_in_package: boolean;
};

export type CoverageEntry = { file: string; decorated_units: number; undecorated_units: number };

export type AdherenceData = {
  package: string;
  intents: AdherenceIntentEntry[];
  coverage: CoverageEntry[];
};

export function AdherencePanel({ data }: { data: AdherenceData }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Adherence</h1>
      <p className="text-gray-500 mb-6">Per-intent satisfaction for {data.package}, computed on demand from the derived index.</p>
      <ul className="space-y-2">
        {data.intents.map((intent) => (
          <li key={intent.path} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${intent.satisfied ? "bg-green-500" : "bg-amber-500"}`} aria-hidden />
              <span className="font-mono text-sm">{intent.path}</span>
              <span className="text-xs text-gray-400 uppercase">{intent.obligation}</span>
              {intent.claimed_in_package && <span className="text-xs text-indigo-500">claimed here</span>}
            </div>
            <p className="text-sm text-gray-600 mt-1">{intent.description}</p>
            <p className="text-xs text-gray-500 mt-1">
              {intent.total_aspects - intent.unsatisfied_aspects.length}/{intent.total_aspects} aspects satisfied
              {intent.unsatisfied_aspects.length > 0 && <> — unsatisfied: {intent.unsatisfied_aspects.join(", ")}</>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

type TreeNode = { segment: string; path: string; entry?: AdherenceIntentEntry; children: TreeNode[] };

function buildTree(intents: AdherenceIntentEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const find = (nodes: TreeNode[], segment: string): TreeNode | undefined => nodes.find((n) => n.segment === segment);
  for (const entry of intents) {
    const segments = entry.path.split("/");
    let level = roots;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let node = find(level, segment);
      if (!node) {
        node = { segment, path, children: [] };
        level.push(node);
      }
      if (path === entry.path) node.entry = entry;
      level = node.children;
    }
  }
  return roots;
}

function TreeBranch({ node }: { node: TreeNode }) {
  return (
    <li className="ml-4">
      <span className="font-mono text-sm">
        {node.segment}
        {node.entry && <span className={`ml-2 text-xs ${node.entry.satisfied ? "text-green-600" : "text-amber-600"}`}>{node.entry.satisfied ? "satisfied" : "unsatisfied"}</span>}
      </span>
      {node.children.length > 0 && (
        <ul className="border-l border-gray-200 mt-1">
          {node.children.map((child) => (
            <TreeBranch key={child.path} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function IntentTreePanel({ data }: { data: AdherenceData }) {
  const tree = buildTree(data.intents);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Intent tree</h1>
      <p className="text-gray-500 mb-6">The hierarchical intent graph for {data.package}.</p>
      <ul>
        {tree.map((node) => (
          <TreeBranch key={node.path} node={node} />
        ))}
      </ul>
    </div>
  );
}

export function CoveragePanel({ data }: { data: AdherenceData }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Decoration coverage</h1>
      <p className="text-gray-500 mb-6">Decorated vs undecorated units per file in {data.package}.</p>
      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="p-2">File</th>
            <th className="p-2">Decorated</th>
            <th className="p-2">Undecorated</th>
          </tr>
        </thead>
        <tbody>
          {data.coverage.map((row) => (
            <tr key={row.file} className="border-t border-gray-100">
              <td className="p-2 font-mono">{row.file}</td>
              <td className="p-2">{row.decorated_units}</td>
              <td className="p-2">{row.undecorated_units}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
