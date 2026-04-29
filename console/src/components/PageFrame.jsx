export function PageFrame({
  eyebrow,
  title,
  description,
  actions = null,
  hideHeader = false,
  children
}) {
  return (
    <section className="page-frame">
      {hideHeader ? null : (
        <div className="page-frame-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3>{title}</h3>
            <p className="page-description">{description}</p>
          </div>
          {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
