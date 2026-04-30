import { Card, Space, Typography } from "@arco-design/web-react";

const { Paragraph, Text, Title } = Typography;

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
        <Card className="page-frame-header arco-page-card" bordered>
          <Space align="start" className="page-frame-header-inner" size={16}>
            <div className="page-frame-title-block">
              {eyebrow ? <Text className="eyebrow">{eyebrow}</Text> : null}
              <Title heading={3} className="page-title">
                {title}
              </Title>
              {description ? (
                <Paragraph className="page-description">{description}</Paragraph>
              ) : null}
            </div>
            {actions ? <div className="page-actions">{actions}</div> : null}
          </Space>
        </Card>
      )}
      {children}
    </section>
  );
}
