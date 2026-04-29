export function PlaceholderPanel({ title, detail, items = [] }) {
  return (
    <article className="placeholder-panel">
      <h4>{title}</h4>
      <p>{detail}</p>
      {items.length > 0 ? (
        <ul className="placeholder-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
