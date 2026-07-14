
export default function Dashboard() {
  const rows = [
    { run: "r007", tokens: 604 },
    { run: "r023", tokens: 1921 },
  ];
  return (
    <div>
      <h1>Run results</h1>
      <table>
        <thead><tr><th>Run</th><th>Tokens</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.run}><td>{row.run}</td><td>{row.tokens}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
