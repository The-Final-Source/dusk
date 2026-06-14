/**
 * Metrics panel — the web end of the Dusk self-measurement vertical slice
 * (v1.x). Renders the dogfood go/no-go report and the static-analysis report
 * served by the pipeline-built `metrics` tRPC router. Pure presentational; the
 * shapes are structurally typed so packages/web needs no new dependency.
 */

type GatedCount = { value: number; threshold: string; pass: boolean };
type GatedEnum = { value: string; threshold: string; pass: boolean };

export type DogfoodGating = {
  e2e_implement_success_count: GatedCount;
  gate_false_positive_count: GatedCount;
  worked_example_regression: GatedEnum;
  package_test_suite: GatedEnum;
  pass: boolean;
};

export type DogfoodReportView = {
  package: string;
  window: { days: number };
  gating: DogfoodGating;
};

export type StaticFindingView = { class: string; file: string; line: number; severity: string };
export type DensityEntryView = { file: string; decorated_units: number; undecorated_units: number };
export type StaticAnalysisReportView = {
  mode: string;
  findings: StaticFindingView[];
  density_baseline: DensityEntryView[];
};

export type Envelope<T> = { present: boolean; data: T | null };

const GATE_LABELS: Array<[keyof DogfoodGating, string]> = [
  ["e2e_implement_success_count", "End-to-end implement success"],
  ["gate_false_positive_count", "Gate false positives"],
  ["worked_example_regression", "Worked-example regression"],
  ["package_test_suite", "Package test suite"],
];

export function MetricsPanel({ dogfood, staticAnalysis }: { dogfood: Envelope<DogfoodReportView>; staticAnalysis: Envelope<StaticAnalysisReportView> }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dusk metrics</h1>
      <p className="text-gray-500 mb-6">Self-measurement artifacts served by the metrics tRPC surface.</p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Dogfood go/no-go</h2>
        {!dogfood.present || !dogfood.data ? (
          <p className="text-gray-400 text-sm">No dogfood report available.</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${dogfood.data.gating.pass ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {dogfood.data.gating.pass ? "GO" : "NO-GO"}
              </span>
              <span className="text-sm text-gray-500">
                {dogfood.data.package} · day {dogfood.data.window.days} of the window
              </span>
            </div>
            <ul className="space-y-1 text-sm">
              {GATE_LABELS.map(([key, label]) => {
                const g = dogfood.data!.gating[key] as GatedCount | GatedEnum;
                return (
                  <li key={key} className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${g.pass ? "bg-green-500" : "bg-red-500"}`} aria-hidden />
                    <span className="font-mono">{label}</span>
                    <span className="text-gray-500">
                      {String(g.value)} ({g.threshold})
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Static analysis</h2>
        {!staticAnalysis.present || !staticAnalysis.data ? (
          <p className="text-gray-400 text-sm">No static-analysis report available.</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500 mb-2">
              mode: <span className="font-mono">{staticAnalysis.data.mode}</span> · {staticAnalysis.data.findings.length} finding(s)
            </p>
            {staticAnalysis.data.findings.length > 0 && (
              <ul className="space-y-1 text-sm mb-3">
                {staticAnalysis.data.findings.map((f, i) => (
                  <li key={i} className="font-mono text-xs">
                    [{f.severity}] {f.class} — {f.file}:{f.line}
                  </li>
                ))}
              </ul>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1">File</th>
                  <th className="py-1">Decorated</th>
                  <th className="py-1">Undecorated</th>
                </tr>
              </thead>
              <tbody>
                {staticAnalysis.data.density_baseline.map((d) => (
                  <tr key={d.file} className="border-t border-gray-100">
                    <td className="py-1 font-mono">{d.file}</td>
                    <td className="py-1">{d.decorated_units}</td>
                    <td className="py-1">{d.undecorated_units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
