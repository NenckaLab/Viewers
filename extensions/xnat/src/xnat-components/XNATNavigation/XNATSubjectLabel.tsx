import React from 'react';

interface XNATSubjectLabelProps {
  ID: string;
  label: string;
  active: boolean;
  shared: boolean;
  parentProjectId: string;
}

export default class XNATSubjectLabel extends React.Component<XNATSubjectLabelProps> {
  constructor(props: XNATSubjectLabelProps) {
    super(props);
  }

  render() {
    const { ID, label, active, shared, parentProjectId } = this.props;

    return (
      <div>
        {active ? (
          <div className="text-sm font-bold text-primary">{label}</div>
        ) : (
          <div className="text-sm text-foreground">{label}</div>
        )}
        {shared ? (
          <div className="text-xs text-muted-foreground italic">{`Shared from ${parentProjectId}`}</div>
        ) : null}
      </div>
    );
  }
}
