import React, { Component } from "react";
import browser from "webextension-polyfill";
import log from "loglevel";
import url from "url";
import {
  initSettings,
  getSettings,
  setSettings,
  handleSettingsChange
} from "src/settings/settings";
import { updateLogLevel, overWriteLogLevel } from "src/common/log";
import {
  getSessions,
  sendSessionSaveMessage,
  sendSessionRemoveMessage,
  sendSessionUpdateMessage
} from "../actions/controlSessions";
import { deleteWindow, deleteTab } from "../../common/editSessions.js";
import openUrl from "../actions/openUrl";
import Header from "./Header";
import OptionsArea from "./OptionsArea";
import SessionsArea from "./SessionsArea";
import SessionDetailsArea from "./SessionDetailsArea";
import Notification from "./Notification";
import SaveArea from "./SaveArea";
import Menu from "./Menu";
import Modal from "./Modal";
import Error from "./Error";
import DonationMessage from "./DonationMessage";
import "../styles/PopupPage.scss";

const logDir = "popup/components/PopupPage";

export default class PopupPage extends Component {
  constructor(props) {
    super(props);
    this.state = {
      sessions: [],
      isInitSessions: false,
      selectedSession: {},
      removedSession: {},
      filterValue: "_displayAll",
      sortValue: "newest",
      isShowSearchBar: false,
      searchWord: "",
      isInTab: false,
      notification: {
        message: "",
        type: "info",
        buttonLabel: "",
        onClick: () => {}
      },
      menu: {
        isOpen: false,
        x: 0,
        y: 0,
        items: <div />
      },
      modal: {
        isOpen: false,
        title: "Title",
        content: <div />
      },
      error: {
        isError: false,
        type: ""
      }
    };

    this.init();
  }

  init = async () => {
    await initSettings();
    overWriteLogLevel();
    updateLogLevel();
    log.info(logDir, "init()");

    const isInTab = url.parse(location.href).hash == "#inTab";
    if (!isInTab) {
      document.body.style.width = `${getSettings("popupWidthV2")}px`;
      document.body.style.height = `${getSettings("popupHeight")}px`;
      if (getSettings("isSessionListOpenInTab")) {
        const popupUrl = "../popup/index.html#inTab";
        openUrl(popupUrl);
        window.close();
      }
    }
    this.setState({
      sortValue: getSettings("sortValue") || "newest",
      isShowSearchBar: getSettings("isShowSearchBar"),
      isInTab: isInTab
    });

    const isInit = await browser.runtime.sendMessage({ message: "getInitState" });
    if (!isInit) this.setState({ error: { isError: true, type: "indexedDB" } });

    const keys = ["id", "name", "date", "tag", "tabsNumber", "windowsNumber"];
    const sessions = await getSessions(null, keys);
    this.setState({
      sessions: sessions,
      isInitSessions: true,
      filterValue: getSettings("filterValue") || "_displayAll"
    });

    const selectedSessionId = getSettings("selectedSessionId");
    if (selectedSessionId) this.selectSession(selectedSessionId);

    browser.runtime.onMessage.addListener(this.changeSessions);
    browser.storage.onChanged.addListener(handleSettingsChange);

    if (getSettings("isShowUpdated")) {
      this.openNotification({
        message: browser.i18n.getMessage("NotificationOnUpdateLabel"),
        type: "info",
        duration: 20000,
        buttonLabel: browser.i18n.getMessage("seeMoreLabel"),
        onClick: () => openUrl("../options/index.html#information?action=updated")
      });
      setSettings("isShowUpdated", false);
    }

    if (Math.random() < 0.03) {
      this.openModal(browser.i18n.getMessage("donationLabel"), <DonationMessage />);
    }
  };

  changeSessions = async request => {
    log.info(logDir, "changeSessions()", request);
    let sessions;
    let selectedSession = this.state.selectedSession;

    switch (request.message) {
      case "saveSession": {
        const newSession = request.session;
        sessions = this.state.sessions.concat(newSession);
        break;
      }
      case "updateSession": {
        const newSession = request.session;
        if (newSession.id === selectedSession.id) selectedSession = newSession;

        sessions = this.state.sessions;
        const index = sessions.findIndex(session => session.id === newSession.id);
        if (index === -1) sessions = this.state.sessions.concat(newSession);
        else sessions.splice(index, 1, newSession);
        break;
      }
      case "deleteSession": {
        const deletedSessionId = request.id;
        if (deletedSessionId === selectedSession.id) selectedSession = {};

        sessions = this.state.sessions;
        const index = sessions.findIndex(session => session.id === deletedSessionId);
        if (index === -1) return;
        sessions.splice(index, 1);
        break;
      }
      case "deleteAll": {
        const keys = ["id", "name", "date", "tag", "tabsNumber", "windowsNumber"];
        sessions = await getSessions(null, keys);
        selectedSession = {};
        break;
      }
    }
    this.setState({ sessions: sessions, selectedSession: selectedSession });
  };

  changeFilterValue = value => {
    log.info(logDir, "changeFilterValue()", value);
    this.setState({ filterValue: value });
    setSettings("filterValue", value);
  };

  changeSortValue = value => {
    log.info(logDir, "changeSortValue()", value);
    this.setState({ sortValue: value });
    setSettings("sortValue", value);
  };

  changeSearchWord = searchWord => {
    log.info(logDir, "changeSearchValue()", searchWord);
    this.setState({ searchWord: searchWord.trim() });
  };

  selectSession = async id => {
    log.info(logDir, "selectSession()", id);
    const selectedSession = await getSessions(id);
    this.setState({ selectedSession: selectedSession || {} });
    setSettings("selectedSessionId", id);
  };

  saveSession = async (name, property) => {
    log.info(logDir, "saveSession()", name, property);
    try {
      const savedSession = await sendSessionSaveMessage(name, property);
      this.selectSession(savedSession.id);
      this.openNotification({
        message: browser.i18n.getMessage("sessionSavedLabel"),
        type: "success",
        duration: 2000
      });
    } catch (e) {
      this.openNotification({
        message: browser.i18n.getMessage("failedSaveSessionLabel"),
        type: "error"
      });
    }
  };

  removeSession = async id => {
    log.info(logDir, "removeSession()", id);
    const removedSession = await getSessions(id);
    this.saveRemovedSession(removedSession);
    try {
      await sendSessionRemoveMessage(id);
      this.openNotification({
        message: browser.i18n.getMessage("sessionDeletedLabel"),
        type: "warn",
        buttonLabel: browser.i18n.getMessage("restoreSessionLabel"),
        onClick: this.restoreRemovedSession
      });
    } catch (e) {
      this.openNotification({
        message: browser.i18n.getMessage("failedDeleteSessionLabel"),
        type: "error"
      });
    }
  };

  removeWindow = async (session, winId) => {
    this.saveRemovedSession(session);
    try {
      const editedSession = deleteWindow(session, winId);
      await sendSessionUpdateMessage(editedSession);
      this.openNotification({
        message: browser.i18n.getMessage("sessionWindowDeletedLabel"),
        type: "warn",
        buttonLabel: browser.i18n.getMessage("restoreSessionLabel"),
        onClick: this.restoreRemovedSession
      });
    } catch (e) {
      this.openNotification({
        message: browser.i18n.getMessage("failedDeleteSessionWindowLabel"),
        type: "error"
      });
    }
  };

  removeTab = async (session, winId, tabId) => {
    this.saveRemovedSession(session);
    try {
      const editedSession = deleteTab(session, winId, tabId);
      await sendSessionUpdateMessage(editedSession);
      this.openNotification({
        message: browser.i18n.getMessage("sessionTabDeletedLabel"),
        type: "warn",
        buttonLabel: browser.i18n.getMessage("restoreSessionLabel"),
        onClick: this.restoreRemovedSession
      });
    } catch (e) {
      this.openNotification({
        message: browser.i18n.getMessage("failedDeleteSessionTabLabel"),
        type: "error"
      });
    }
  };

  saveRemovedSession = removedSession => {
    log.info(logDir, "saveRemovedSession()");
    this.setState({
      removedSession: removedSession
    });
  };

  restoreRemovedSession = async () => {
    log.info(logDir, "restoreRemovedSession()");
    const removedSession = this.state.removedSession;
    if (removedSession.id == null) return;
    await sendSessionUpdateMessage(removedSession);
    this.selectSession(removedSession.id);
    this.setState({
      removedSession: {}
    });
  };

  openNotification = notification => {
    log.info(logDir, "openNotification()", notification);
    this.setState({
      notification: {
        key: Date.now(),
        ...notification
      }
    });
  };

  openMenu = (x, y, itemsComponent) => {
    log.info(logDir, "openMenu()", itemsComponent);
    this.lastFocusedElement = document.activeElement;
    this.setState({
      menu: {
        isOpen: true,
        x: x,
        y: y,
        items: itemsComponent
      }
    });
  };

  closeMenu = () => {
    this.setState({
      menu: {
        isOpen: false,
        x: this.state.menu.x,
        y: this.state.menu.y,
        items: this.state.menu.items
      }
    });
    this.lastFocusedElement.focus();
  };

  openModal = (title, contentComponent) => {
    log.info(logDir, "openModal", title);
    this.lastFocusedElement = document.activeElement;
    this.setState({
      modal: {
        isOpen: true,
        title: title,
        content: contentComponent
      }
    });
  };

  closeModal = () => {
    this.setState({
      modal: {
        isOpen: false,
        title: this.state.modal.title,
        content: this.state.modal.content
      }
    });
    this.lastFocusedElement.focus();
  };

  componentDidUpdate() {
    if (this.state.error.isError) return;
    if (this.state.sessions === undefined || this.state.sessions === null) {
      browser.runtime.onMessage.removeListener(this.changeSessions);
      window.close();
      this.setState({ error: { isError: true, type: "noConnection" } });
    }
  }

  render() {
    return (
      <div
        id="popupPage"
        className={this.state.isInTab ? "isInTab" : ""}
        onClick={this.state.menu.isOpen ? this.closeMenu : null}
      >
        <Notification notification={this.state.notification} />
        <Header openModal={this.openModal} />
        <div id="contents">
          <div className="column sidebar">
            <OptionsArea
              sessions={this.state.sessions || []}
              filterValue={this.state.filterValue}
              sortValue={this.state.sortValue}
              isShowSearchBar={this.state.isShowSearchBar}
              changeSearchWord={this.changeSearchWord}
              changeFilter={this.changeFilterValue}
              changeSort={this.changeSortValue}
            />
            <Error error={this.state.error} />
            <SessionsArea
              sessions={this.state.sessions || []}
              selectedSessionId={this.state.selectedSession.id || ""}
              filterValue={this.state.filterValue}
              sortValue={this.state.sortValue}
              searchWord={this.state.searchWord}
              selectSession={this.selectSession}
              openMenu={this.openMenu}
              isInitSessions={this.state.isInitSessions}
              error={this.state.error}
            />
            <SaveArea openMenu={this.openMenu} saveSession={this.saveSession} />
          </div>
          <div className="column">
            <SessionDetailsArea
              session={this.state.selectedSession}
              removeSession={this.removeSession}
              removeWindow={this.removeWindow}
              removeTab={this.removeTab}
              openMenu={this.openMenu}
              openModal={this.openModal}
              closeModal={this.closeModal}
            />
          </div>
        </div>
        <Menu menu={this.state.menu} />
        <Modal modal={this.state.modal} closeModal={this.closeModal} />
      </div>
    );
  }
}
