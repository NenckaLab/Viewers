import React from 'react';



interface XNATProjectLabelProps {
  ID: string;
  name: string;
  active: boolean;
}

export default class XNATProjectLabel extends React.Component<XNATProjectLabelProps> {
  constructor(props: XNATProjectLabelProps) {
    super(props);
  }

  render() {
    const { active, name } = this.props;

    return (
      <div>
        {active ? (
          <div className="text-sm font-bold text-primary">{name}</div>
        ) : (
          <div className="text-sm text-foreground">{name}</div>
        )}
      </div>
    );
  }
}
