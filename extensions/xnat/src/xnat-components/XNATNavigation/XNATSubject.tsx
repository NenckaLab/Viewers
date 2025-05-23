import React from 'react';
import XNATSubjectLabel from './XNATSubjectLabel';
import XNATSessionList from './XNATSessionList';
import SubjectRouter from './helpers/SubjectRouter';
import fetchJSON from '../../utils/IO/fetchJSON';
import onExpandIconClick from './helpers/onExpandIconClick';
import getExpandIcon from './helpers/getExpandIcon';
import compareOnProperty from './helpers/compareOnProperty';
import sessionMap from '../../utils/sessionMap';
import navigateConfirmationContent from './helpers/navigateConfirmationContent';
//import { getUnsavedRegions } from 'meteor/icr:peppermint-tools';
//import awaitConfirmationDialog from '../../../lib/dialogUtils/awaitConfirmationDialog.js';
//import progressDialog from '../../../lib/dialogUtils/progressDialog.js';

import { Icons } from '@ohif/ui-next';

import '../XNATNavigationPanel.css';

interface Session {
  ID: string;
  label: string;
  [key: string]: any;
}

interface XNATSubjectProps {
  ID: string;
  label: string;
  projectId: string;
  parentProjectId: string;
}

interface XNATSubjectState {
  sessions: Session[];
  active: boolean;
  subjectViewActive: boolean;
  shared: boolean;
  expanded: boolean;
  fetched: boolean;
}

export default class XNATSubject extends React.Component<XNATSubjectProps, XNATSubjectState> {
  private _cancelablePromises: any[] = [];
  getExpandIcon: () => JSX.Element;
  onExpandIconClick: () => void;

  constructor(props: XNATSubjectProps) {
    super(props);

    const active =
      this.props.projectId === sessionMap.getProject() &&
      this.props.ID === sessionMap.getSubject();
    const subjectViewActive = active && sessionMap.getView() === 'subject';

    const shared = this.props.parentProjectId !== this.props.projectId;

    this.state = {
      sessions: [],
      active,
      subjectViewActive,
      shared,
      expanded: false,
      fetched: false,
    };

    this.onViewSubjectClick = this.onViewSubjectClick.bind(this);

    this.getExpandIcon = getExpandIcon.bind(this);
    this.onExpandIconClick = onExpandIconClick.bind(this);

    this._cancelablePromises = [];
  }

  /**
   * componentWillUnmount - If any promises are active, cancel them to avoid
   * memory leakage by referencing `this`.
   *
   * @returns {null}
   */
  componentWillUnmount(): void {
    const cancelablePromises = this._cancelablePromises;

    for (let i = 0; i < cancelablePromises.length; i++) {
      if (typeof cancelablePromises[i].cancel === 'function') {
        cancelablePromises[i].cancel();
      }
    }
  }

  /**
   * fetchData - Fetches the Subject's list of sessions.
   *
   * @returns {Object} A cancelablePromise.
   */
  fetchData(): Promise<any> {
    const cancelablePromise = fetchJSON(
      `data/archive/projects/${this.props.projectId}/subjects/${this.props.ID}/experiments?format=json`
    );

    this._cancelablePromises.push(cancelablePromise);

    cancelablePromise.promise
      .then(result => {
        if (!result) {
          return;
        }

        const sessions = result.ResultSet.Result;

        sessions.sort((a, b) => compareOnProperty(a, b, 'label'));

        this.setState({
          sessions,
          fetched: true,
        });
      })
      .catch(err => console.log(err));

    return cancelablePromise.promise;
  }

  /**
   * onViewSubjectClick - Check if there are any unsaved annotations and warn
   * the user if there. Then route to subject view.
   *
   * @returns {null}
   */
  onViewSubjectClick(): void {
    if (this.state.subjectViewActive) {
      return;
    }

    // TODO -> Once we have tools we can check the regions
    // const unsavedRegions = getUnsavedRegions();

    // if (unsavedRegions.hasUnsavedRegions) {
    //   const content = navigateConfirmationContent(unsavedRegions);

    //   awaitConfirmationDialog(content).then(result => {
    //     if (result === true) {
    //       this._routeToSubjectView();
    //     }
    //   });
    //   return;
    // } else {
    if (this.state.fetched) {
      this._routeToSubjectView();
    } else {
      this.fetchData().then(() => this._routeToSubjectView());
    }
    // }
  }

  /**
   * _routeToSubjectView - Initialise Router and route to new subject view.
   *
   * @returns {null}
   */
  _routeToSubjectView(): void {
    const { projectId, parentProjectId, ID, label } = this.props;
    const { sessions } = this.state;

    const subjectRouter = new SubjectRouter(
      projectId,
      parentProjectId,
      ID,
      label,
      sessions
    );
    subjectRouter.go();
  }

  /**
   * _getSubjectButtonClassNames - Returns the class names for the subject
   * button based on state.
   *
   * @returns {string}  A string of the classnames.
   */
  _getSubjectButtonClassNames(): string {
    let subjectButtonClassNames = 'btn btn-sm btn-primary xnat-nav-button';

    if (this.state.subjectViewActive) {
      subjectButtonClassNames += ' xnat-nav-button-disabled';
    }

    return subjectButtonClassNames;
  }

  render(): React.ReactNode {
    const { ID, label, projectId, parentProjectId } = this.props;
    const { sessions, active, shared, fetched, expanded } = this.state;
    const subjectButtonClassNames = this._getSubjectButtonClassNames();

    return (
      <React.Fragment>
        <div className="xnat-nav-horizontal-box">
          <a
            className="btn btn-sm btn-secondary"
            onClick={this.onExpandIconClick}
          >
            {this.getExpandIcon()}
          </a>
          <a
            className={subjectButtonClassNames}
            onClick={this.onViewSubjectClick}
          >
            <Icons.LaunchInfo />
          </a>
          <XNATSubjectLabel
            ID={ID}
            label={label}
            active={active}
            shared={shared}
            parentProjectId={parentProjectId}
          />
        </div>
        {expanded ? (
          <XNATSessionList
            projectId={projectId}
            parentProjectId={parentProjectId}
            subjectId={ID}
            sessions={sessions}
            fetched={fetched}
          />
        ) : null}
      </React.Fragment>
    );
  }
}
