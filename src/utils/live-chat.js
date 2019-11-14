// import * as LivechatVisitorSDK from "@livechat/livechat-visitor-sdk";
import * as CustomerSDK from "@livechat/customer-sdk"; // live chat
// customerSDK.auth.getToken().then(token => console.log(token));
var stripHtml = require("striptags");

export class LiveChat {
  constructor(store, useLocalStorage, storageKey, teneoChatHistory) {
    this.store = store;
    this.tts = store.state.tts.tts;
    this.useLocalStorage = useLocalStorage;
    this.storageKey = storageKey;
    this.teneoChatHistory = teneoChatHistory;
    this.sdk;
    this.chatId;
    this.authToken;
    this.initialize();
    this.agent = {};
    this.historyStates = {
      DONE: "DONE",
      INACTIVE: "INACTIVE",
      LOADING: "LOADING"
    };
  }

  initialize() {
    const noop = () => {};
    try {
      if (
        this.store.getters.enableLiveChat &&
        process.env.VUE_APP_LIVE_CHAT_INC_KEY
      ) {
        this.sdk = CustomerSDK.init({
          license: parseInt(process.env.VUE_APP_LIVE_CHAT_INC_KEY),
          clientId: "5e68dfc9597a892b27eb97740abe1fee"
        });

        // this.sdk = CustomerSDK.debug(
        //   CustomerSDK.init({
        //     license: parseInt(process.env.VUE_APP_LIVE_CHAT_INC_KEY),
        //     clientId: "5e68dfc9597a892b27eb97740abe1fee"
        //   })
        // );
        window.sdk = this.sdk;
        // console.log(this.sdk);

        this.sdk.auth
          .getToken()
          .then(token => (this.accessToken = token.accessToken));

        this.sdk.on("connected", payload => {
          if (payload.chatsSummary.length > 0) {
            this.chatId = payload.chatsSummary[0].id;
          }
        });

        this.sdk.on("connection_lost", noop);
        this.sdk.on("connection_restored", noop);
        this.sdk.on("user_left_chat", noop);
        this.sdk.on("customer_id", noop);

        this.sdk.on("disconnected", reason => {
          console.log(reason);
        });

        this.sdk.on("user_data", user => {
          if (user.type === "agent") {
            this.agent = user;
          }
          // console.log(`USER DATA:`);
          // console.log(user);
          // const agent = {
          //   avatar:
          //     "https://cdn.livechatinc.com/cloud/?uri=https%3A%2F%2Flivechat.s3.amazonaws.com%2F9243615%2Favatars%2Fa102134835ab6bef075d58912e55d099.png",
          //   id: "ae9a46e6c60d18cedb4c6bf12bb0e3e5",
          //   jobTitle: "Support Agent",
          //   name: "Peter",
          //   type: "agent"
          // };
          this.store.commit("AGENT_NAME", user.name);
          this.store.commit("AGENT_ID", user.id);
          this.store.commit("AGENT_AVATAR", user.avatar);
        });

        this.sdk.on("user_joined_chat", ({ user, chat }) => {
          this.chatId = chat;
          if (user === this.agent.id) {
            this.startLiveChat();
          }
        });

        this.sdk.on("thread_summary", threadSummary => {
          this.chatId = threadSummary.chat;
          let secondsWait = threadSummary.properties.lc2.queue_waiting_time;
          let message =
            "Chat request sent to agent. You are number " +
            threadSummary.properties.lc2.queue_pos +
            " in the queue. Average wait time is " +
            (Math.floor(secondsWait / 60) +
              " min " +
              ("0" + Math.floor(secondsWait % 60)).slice(-2)) +
            " seconds";
          // only display messages if live chat is active (check for isLiveChat prevents messages from showing when user refreshed the page)
          let liveChatStatus = {
            type: "liveChatQueue",
            text: message,
            bodyText: "",
            hasExtraData: false
          };
          this.store.commit("PUSH_LIVE_CHAT_STATUS_TO_DIALOG", liveChatStatus); // push the getting message onto the dialog
        });

        this.sdk.on("new_event", ({ chat, event }) => {
          // console.log(event.type);
          switch (event.type) {
            case "message":
              if (!this.chatId) {
                this.chatId = chat;
                this.startLiveChat();
              }

              if (event.author === this.agent.id) {
                // console.log("new message from agent - ", event.text);

                let liveChatResponse = {
                  type: "liveChatResponse",
                  text: event.text,
                  agentAvatar: this.store.getters.agentAvatar,
                  agentName: this.store.getters.agentName,
                  bodyText: "",
                  hasExtraData: false
                };
                this.store.commit(
                  "PUSH_LIVE_CHAT_RESPONSE_TO_DIALOG",
                  liveChatResponse
                ); // push the getting message onto the dialog
                if (
                  Object.prototype.hasOwnProperty.call(
                    window,
                    "webkitSpeechRecognition"
                  ) &&
                  Object.prototype.hasOwnProperty.call(
                    window,
                    "speechSynthesis"
                  )
                ) {
                  if (this.tts && this.store.getters.speakBackResponses) {
                    this.tts.say(stripHtml(event.text));
                  }
                }

                if (this.useLocalStorage) {
                  localStorage.setItem(
                    this.storageKey + this.teneoChatHistory,
                    JSON.stringify(this.store.getters.dialog)
                  );
                }
                this.store.commit(
                  "SET_DIALOG_HISTORY",
                  JSON.parse(
                    sessionStorage.getItem(
                      this.storageKey + this.teneoChatHistory
                    )
                  )
                );
                if (this.store.getters.dialogHistory === null) {
                  this.store.commit(
                    "SET_DIALOG_HISTORY",
                    this.store.getters.dialog
                  );
                } else {
                  this.store.commit(
                    "PUSH_RESPONSE_TO_DIALOG_HISTORY",
                    liveChatResponse
                  );
                }
                sessionStorage.setItem(
                  this.storageKey + this.teneoChatHistory,
                  JSON.stringify(this.store.getters.dialogHistory)
                );
                this.store.commit("CLEAR_USER_INPUT");
              } else {
                // console.log("new user message toagent - ", event.text);
              }
              break;
            default:
              break;
          }
        });

        this.sdk.on("user_is_typing", payload => {
          if (payload.user === this.agent.id) {
            this.store.commit("LIVE_CHAT_LOADING", true);
          } else {
            // user is typing something
          }
        });

        this.sdk.on("user_stopped_typing", payload => {
          if (payload.user === this.agent.id) {
            this.store.commit("LIVE_CHAT_LOADING", false);
          } else {
            // user is typing something
          }
        });

        this.sdk.on("thread_closed", () => {
          // console.log(`chat_ended`);
          let message = "Chat with live agent ended.";
          this.store.commit("RESET_CHAT_TITLE");
          // only display messages if live chat is active (check for isLiveChat prevents messages from showing when user refreshed the page)
          let liveChatStatus = {
            type: "liveChatEnded",
            text: message,
            bodyText: "",
            hasExtraData: false
          };
          this.store.commit("PUSH_LIVE_CHAT_STATUS_TO_DIALOG", liveChatStatus); // push the getting message onto the dialog
          this.store.commit("STOP_LIVE_CHAT");
          if (!this.store.getters.hasLoggedInTeneo) {
            this.store
              .dispatch("login")
              .then(() => {
                console.log("Successfully established chat session");
              })
              .catch(err => {
                console.log("ERROR LOGGING IN TO CHAT: ", err.message);
              });
          }
        });
      }
    } catch (e) {
      console.log("Error Setting Up Live Chat");
      console.error(e);
    }
  }

  startLiveChat() {
    this.store.commit("CHANGE_CHAT_TITLE", `Speaking with ${this.agent.name}`);

    this.store.commit("START_LIVE_CHAT");
    // show typing output agentName + ' is typing...'

    let message = "You are talking to " + this.agent.name + ".";

    // only display messages if live chat is active (check for isLiveChat prevents messages from showing when user refreshed the page)

    let liveChatStatus = {
      type: "liveChatStatus",
      text: message,
      bodyText: "",
      hasExtraData: false
    };
    this.store.commit("PUSH_LIVE_CHAT_STATUS_TO_DIALOG", liveChatStatus); // push the getting message onto the dialog
    this.store
      .dispatch("openChatWindow", false)
      .then(() => {
        // console.log("Successfully logged into chat");
        setTimeout(
          function() {
            this.store.commit("SHOW_CHAT_BUTTON"); // only show the open chat button once the session has ended
          }.bind(this),
          1500
        ); // only show the chat button after a successful login
      })
      .catch(err => {
        console.error(
          "ERROR OPENING CHAT FORM INCOMING LIVE CHAT MESSAGE: ",
          err.message
        );
      });
  }

  /**
   * Send a message to message to the live chat agent
   *
   * @param {*} message
   */
  sendMessage(message) {
    // console.log("Sending message to LiveChat Agent:" + message);
    if (this.chatId) {
      this.sdk
        .sendEvent(this.chatId, {
          type: "message",
          text: message
        })
        .catch(error => {
          console.log(error);
        });
    } else {
      this.sdk
        .startChat({
          events: [
            {
              type: "message",
              text: message
            }
          ]
        })
        .then(chat => {
          this.chatId = chat;
          // console.log(chat);
        })
        .catch(error => {
          console.error(error);
        });
    }
  }
}
