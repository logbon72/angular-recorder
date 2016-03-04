'use strict';

angular.module('angularAudioRecorder.services')
  .provider('recorderService', ['recorderScriptUrl',
    function (recorderScriptUrl) {
      var handler = null,
        service = {isHtml5: false, isReady: false},
        permissionHandlers = {onDenied: null, onClosed: null, onAllow: null},
        forceSwf = false,
        /*this path is relative to the dist path:*/
        swfUrl = recorderScriptUrl + '../lib/recorder.swf',
        utils,
        mp3Covert = false,
        mp3Config = {bitRate: 92, lameJsUrl: recorderScriptUrl + '../lib/lame.min.js'}
        ;

      var swfHandlerConfig = {
        isAvailable: false,
        loaded: false,
        configureMic: function () {
          if (!FWRecorder.isReady) {
            return;
          }
          FWRecorder.configure(44, 100, 0, 2000);
          FWRecorder.setUseEchoSuppression(false);
          FWRecorder.setLoopBack(false);
        },
        allowed: false,
        externalEvents: function (eventName) {
          //Actions based on user interaction with flash
          var name = arguments[1];
          switch (arguments[0]) {
            case "ready":
              var width = parseInt(arguments[1]);
              var height = parseInt(arguments[2]);
              FWRecorder.connect('recorder-app', 0);
              FWRecorder.recorderOriginalWidth = 1;
              FWRecorder.recorderOriginalHeight = 1;
              swfHandlerConfig.loaded = true;
              break;

            case "microphone_user_request":
              FWRecorder.showPermissionWindow({permanent: true});
              break;

            case "microphone_connected":
              console.log('Permission to use MIC granted');
              swfHandlerConfig.allowed = true;
              break;

            case "microphone_not_connected":
              console.log('Permission to use MIC denied');
              swfHandlerConfig.allowed = false;
              break;

            case "permission_panel_closed":
              if (swfHandlerConfig.allowed) {
                swfHandlerConfig.setAllowed();
              } else {
                swfHandlerConfig.setDeclined();
              }
              FWRecorder.defaultSize();
              if (angular.isFunction(permissionHandlers.onClosed)) {
                permissionHandlers.onClosed();
              }
              break;

            case "recording":
              FWRecorder.hide();
              break;

            case "recording_stopped":
              FWRecorder.hide();
              break;

            case "playing":

              break;

            case "playback_started":

              var latency = arguments[2];
              break;

            case "save_pressed":
              FWRecorder.updateForm();
              break;

            case "saving":
              break;

            case "saved":
              var data = $.parseJSON(arguments[2]);
              if (data.saved) {

              } else {

              }
              break;

            case "save_failed":
              var errorMessage = arguments[2];
              break;

            case "save_progress":
              var bytesLoaded = arguments[2];
              var bytesTotal = arguments[3];
              break;

            case "stopped":
            case "playing_paused":
            case "no_microphone_found":
            case "observing_level":
            case "microphone_level":
            case "microphone_activity":
            case "observing_level_stopped":
            default:
              //console.log('Event Received: ', arguments);
              break;
          }

        },
        isInstalled: function () {
          return swfobject.getFlashPlayerVersion().major > 0;
        },
        init: function () {
          //Flash recorder external events
          service.isHtml5 = false;
          if (!swfHandlerConfig.isInstalled()) {
            console.log('Flash is not installed, application cannot be initialized');
            return;
          }
          swfHandlerConfig.isAvailable = true;
          //handlers
          window.fwr_event_handler = swfHandlerConfig.externalEvents;
          window.configureMicrophone = swfHandlerConfig.configureMic;
        },
        setAllowed: function () {
          service.isReady = true;
          handler = FWRecorder;
          if (angular.isFunction(permissionHandlers.onAllowed)) {
            permissionHandlers.onAllowed();
          }
        },
        setDeclined: function () {
          service.isReady = false;
          handler = null;
          if (angular.isFunction(permissionHandlers.onDenied)) {
            permissionHandlers.onDenied();
          }
        },
        getPermission: function () {
          if (swfHandlerConfig.isAvailable) {
            if (!FWRecorder.isMicrophoneAccessible()) {
              FWRecorder.showPermissionWindow({permanent: true});
            } else {
              swfHandlerConfig.allowed = true;
              setTimeout(function () {
                swfHandlerConfig.setAllowed();
              }, 100);
            }

          }
        }
      };


      var html5AudioProps = {
        audioContext: null,
        inputPoint: null,
        audioInput: null,
        audioRecorder: null,
        analyserNode: null
      };

      var html5HandlerConfig = {
        gotStream: function (stream) {
          var audioContext = html5AudioProps.audioContext;
          // Create an AudioNode from the stream.
          html5AudioProps.audioInput = audioContext.createMediaStreamSource(stream);
          html5AudioProps.audioInput.connect((html5AudioProps.inputPoint = audioContext.createGain()));

          //analyser
          html5AudioProps.analyserNode = audioContext.createAnalyser();
          html5AudioProps.analyserNode.fftSize = 2048;
          html5AudioProps.inputPoint.connect(html5AudioProps.analyserNode);
          html5AudioProps.audioRecorder = new Recorder(html5AudioProps.audioInput);

          //create Gain
          var zeroGain = audioContext.createGain();
          zeroGain.gain.value = 0.0;
          html5AudioProps.inputPoint.connect(zeroGain);
          zeroGain.connect(audioContext.destination);

          //service booted
          service.isReady = true;
          handler = html5AudioProps.audioRecorder;

          if (angular.isFunction(permissionHandlers.onAllowed)) {
            if (window.location.protocol == 'https:') {
              //to store permission for https websites
              localStorage.setItem("permission", "given");
            }
            permissionHandlers.onAllowed();
          }

        },
        failStream: function (data) {
          if (angular.isDefined(permissionHandlers.onDenied)) {
            permissionHandlers.onDenied();
          }
        },
        getPermission: function () {
          navigator.getUserMedia({
            "audio": true
          }, html5HandlerConfig.gotStream, html5HandlerConfig.failStream);
        },
        init: function () {
          service.isHtml5 = true;
          var AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext && !html5AudioProps.audioContext) {
            html5AudioProps.audioContext = new AudioContext();
          }

          if (localStorage.getItem("permission") !== null) {
            //to get permission from browser cache for returning user
            html5HandlerConfig.getPermission();
          }
        }
      };

      navigator.getUserMedia = navigator.getUserMedia
        || navigator.webkitGetUserMedia
        || navigator.mozGetUserMedia;


      service.isCordova = false;

      var init = function () {
        if ('cordova' in window) {
          service.isCordova = true;
        } else if (!forceSwf && navigator.getUserMedia) {
          html5HandlerConfig.init();
        } else {
          swfHandlerConfig.init();
        }
      };

      var controllers = {};

      service.controller = function (id) {
        return controllers[id];
      };

      service.getSwfUrl = function () {
        return swfUrl;
      };

      service.setController = function (id, controller) {
        controllers[id] = controller;
      };

      service.isAvailable = function () {
        if (service.isCordova) {
          if (!('Media' in window)) {
            throw new Error('The Media plugin for cordova is required for this library, add plugin using "cordova plugin add cordova-plugin-media"');
          }
          return true;
        }

        return service.isHtml5
          || swfHandlerConfig.isInstalled();
      };

      service.getHandler = function () {
        return handler;
      };

      service.showPermission = function (listeners) {
        if (!service.isAvailable()) {
          console.warn("Neither HTML5 nor SWF is supported.");
          return;
        }

        if (listeners) {
          angular.extend(permissionHandlers, listeners);
        }

        if (service.isHtml5) {
          html5HandlerConfig.getPermission();
        } else {
          swfHandlerConfig.getPermission();
        }
      };

      service.swfIsLoaded = function () {
        return swfHandlerConfig.loaded;
      };

      service.shouldConvertToMp3 = function () {
        return mp3Covert;
      };

      service.getMp3Config = function () {
        return mp3Config;
      };

      service.$html5AudioProps = html5AudioProps;

      var provider = {
        $get: ['recorderUtils',
          function (recorderUtils) {
            utils = recorderUtils;
            init();
            return service;
          }
        ],
        forceSwf: function (value) {
          forceSwf = value;
          return provider;
        },
        setSwfUrl: function (path) {
          swfUrl = path;
          return provider;
        },
        withMp3Conversion: function (bool, config) {
          mp3Covert = !!bool;
          mp3Config = angular.extend(mp3Config, config || {});
          return provider;
        }
      };

      return provider;
    }])
;