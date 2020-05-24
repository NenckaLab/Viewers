// External
import React from 'react';
import PropTypes from 'prop-types';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { ThemeWrapper } from '@ohif/ui';
// Viewer Project
// TODO: Should this influence study list?
import { appConfigContext } from '@state/appConfig.context';
import { useAppConfig } from '@hooks/useAppConfig';
import createRoutes from './routes';
import appInit from './appInit.js';

// Temporarily for testing
import '@ohif/mode-example';

/**
 * ENV Variable to determine routing behavior
 */
const Router = JSON.parse(process.env.USE_HASH_ROUTER)
  ? HashRouter
  : BrowserRouter;

let commandsManager, extensionManager, servicesManager;

function App({ config, defaultExtensions }) {
  const init = appInit(config, defaultExtensions);

  // Set above for named export
  commandsManager = init.commandsManager;
  extensionManager = init.extensionManager;
  servicesManager = init.servicesManager;

  // Set appConfig
  const appConfigContextApi = useAppConfig(init.appConfig);
  const { routerBasename, modes, dataSources } = appConfigContextApi.appConfig;
  // Use config to create routes
  const appRoutes = createRoutes(
    modes,
    dataSources,
    extensionManager,
    servicesManager
  );

  return (
    <appConfigContext.Provider value={appConfigContextApi}>
      <Router basename={routerBasename}>
        <ThemeWrapper>{appRoutes}</ThemeWrapper>
      </Router>
    </appConfigContext.Provider>
  );
}

App.propTypes = {
  config: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({
      routerBasename: PropTypes.string.isRequired,
      oidc: PropTypes.array,
      whiteLabeling: PropTypes.shape({
        createLogoComponentFn: PropTypes.func,
      }),
      extensions: PropTypes.array,
    }),
  ]).isRequired,
  /* Extensions that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultExtensions: PropTypes.array,
};

App.defaultProps = {
  config: {
    /**
     * Relative route from domain root that OHIF instance is installed at.
     * For example:
     *
     * Hosted at: https://ohif.org/where-i-host-the/viewer/
     * Value: `/where-i-host-the/viewer/`
     * */
    routerBaseName: '/',
    /**
     *
     */
    showStudyList: true,
    oidc: [],
    extensions: [],
  },
  defaultExtensions: [],
};

export default App;

export { commandsManager, extensionManager, servicesManager };