(function() {
  'use strict';
window.cancelAnimationFrame = window.cancelAnimationFrame ||
  window.webkitCancelAnimationFrame ||
  window.mozCancelAnimationFrame;

window.requestAnimationFrame = window.requestAnimationFrame ||
  window.webkitRequestAnimationFrame ||
  window.mozRequestAnimationFrame;

angular.module('angularAudioRecorder', [
  'angularAudioRecorder.config',
  'angularAudioRecorder.services',
  'angularAudioRecorder.controllers',
  'angularAudioRecorder.directives'
]);
angular.module('angularAudioRecorder.config', [])
  .constant('recorderScriptUrl', (function () {
    var scripts = document.getElementsByTagName('script');
    var myUrl = scripts[scripts.length - 1].getAttribute('src');
    var path = myUrl.substr(0, myUrl.lastIndexOf('/') + 1);
    var a = document.createElement('a');
    a.href = path;
    return a.href;
  }()))
  .constant('recorderPlaybackStatus', {
    STOPPED: 0,
    PLAYING: 1,
    PAUSED: 2
  })
;
angular.module('angularAudioRecorder.controllers', [
  'angularAudioRecorder.config',
  'angularAudioRecorder.services'
]);
var createReadOnlyVersion = function (object) {
  var obj = {};
  for (var property in object) {
    if (object.hasOwnProperty(property)) {
      Object.defineProperty(obj, property, {
        get: (function (a) {
          var p = a;
          return function () {
            return object[p];
          }
        })(property),
        enumerable: true,
        configurable: true
      });
    }
  }
  return obj;
};


var blobToDataURL = function (blob, callback) {
  var a = new FileReader();
  a.onload = function (e) {
    callback(e.target.result);
  };
  a.readAsDataURL(blob);
};
var RecorderController = function ($element, recorderService, recorderUtils, $scope, $timeout, $interval, recorderPlaybackStatus) {
  //used in NON-Angular Async process
  var scopeApply = function (fn) {
    var phase = $scope.$root.$$phase;
    if (phase !== '$apply' && phase !== '$digest') {
      return $scope.$apply(fn);
    }
  };

  var control = this,
    cordovaMedia = {
      recorder: null,
      url: null,
      player: null
    }, timing = null,
    audioObjId = 'recorded-audio-' + control.id,
    status = {
      isRecording: false,
      playback: recorderPlaybackStatus.STOPPED,
      isDenied: null,
      isSwfLoaded: null,
      isConverting: false,
      get isPlaying() {
        return status.playback === recorderPlaybackStatus.PLAYING;
      },
      get isStopped() {
        return status.playback === recorderPlaybackStatus.STOPPED;
      },
      get isPaused() {
        return status.playback === recorderPlaybackStatus.PAUSED;
      }
    },
    shouldConvertToMp3 = angular.isDefined(control.convertMp3) ? !!control.convertMp3 : recorderService.shouldConvertToMp3(),
    mp3Converter = shouldConvertToMp3 ? new MP3Converter(recorderService.getMp3Config()) : null;
  ;


  control.timeLimit = control.timeLimit || 0;
  control.status = createReadOnlyVersion(status);
  control.isAvailable = recorderService.isAvailable();
  control.elapsedTime = 0;
  //Sets ID for the $element if ID doesn't exists
  if (!control.id) {
    control.id = recorderUtils.generateUuid();
    $element.attr("id", control.id);
  }


  if (!recorderService.isHtml5 && !recorderService.isCordova) {
    status.isSwfLoaded = recorderService.swfIsLoaded();
    $scope.$watch(function () {
      return recorderService.swfIsLoaded();
    }, function (n) {
      status.isSwfLoaded = n;
    });
  }


  //register controller with recorderService
  recorderService.setController(control.id, this);

  var playbackOnEnded = function () {
    status.playback = recorderPlaybackStatus.STOPPED;
    control.onPlaybackComplete();
    scopeApply();
  };

  var playbackOnPause = function () {
    status.playback = recorderPlaybackStatus.PAUSED;
    control.onPlaybackPause();
  };

  var playbackOnStart = function () {
    status.playback = recorderPlaybackStatus.PLAYING;
    control.onPlaybackStart();
  };

  var playbackOnResume = function () {
    status.playback = recorderPlaybackStatus.PLAYING;
    control.onPlaybackResume();
  };

  var embedPlayer = function (blob) {
    if (document.getElementById(audioObjId) == null) {
      $element.append('<audio type="audio/mp3" id="' + audioObjId + '"></audio>');

      var audioPlayer = document.getElementById(audioObjId);
      if (control.showPlayer) {
        audioPlayer.setAttribute('controls', '');
      }

      audioPlayer.addEventListener("ended", playbackOnEnded);
      audioPlayer.addEventListener("pause", function (e) {
        if (this.duration !== this.currentTime) {
          playbackOnPause();
          scopeApply();
        }
      });


      audioPlayer.addEventListener("playing", function (e) {
        if (status.isPaused) {
          playbackOnResume();
        } else {
          playbackOnStart();
        }
        scopeApply();
      });

    }

    if (blob) {
      blobToDataURL(blob, function (url) {
        document.getElementById(audioObjId).src = url;
      });
    } else {
      document.getElementById(audioObjId).removeAttribute('src');
    }
  };

  var doMp3Conversion = function (blobInput, successCallback) {
    if (mp3Converter) {
      status.isConverting = true;
      mp3Converter.convert(blobInput, function (mp3Blob) {
        status.isConverting = false;
        if (successCallback) {
          successCallback(mp3Blob);
        }
        scopeApply(control.onConversionComplete);
      }, function () {
        status.isConverting = false;
      });
      //call conversion started
      control.onConversionStart();
    }
  };

  control.getAudioPlayer = function () {
    return recorderService.isCordova ? cordovaMedia.player : document.getElementById(audioObjId);
  };


  control.startRecord = function () {
    if (!recorderService.isAvailable()) {
      return;
    }

    if (status.isPlaying) {
      control.playbackPause();
      //indicate that this is not paused.
      status.playback = recorderPlaybackStatus.STOPPED;
    }

    //clear audio previously recorded
    control.audioModel = null;

    var id = control.id, recordHandler = recorderService.getHandler();
    //Record initiation based on browser type
    var start = function () {
      if (recorderService.isCordova) {
        cordovaMedia.url = recorderUtils.cordovaAudioUrl(control.id);
        //mobile app needs wav extension to save recording
        cordovaMedia.recorder = new Media(cordovaMedia.url, function () {
          console.log('Media successfully played');
        }, function (err) {
          console.log('Media could not be launched' + err.code, err);
        });
        console.log('CordovaRecording');
        cordovaMedia.recorder.startRecord();
      }
      else if (recorderService.isHtml5) {
        //HTML5 recording
        if (!recordHandler) {
          return;
        }
        console.log('HTML5Recording');
        recordHandler.clear();
        recordHandler.record();
      }
      else {
        //Flash recording
        if (!recorderService.isReady) {
          //Stop recording if the flash object is not ready
          return;
        }
        console.log('FlashRecording');
        recordHandler.record(id, 'audio.wav');
      }

      status.isRecording = true;
      control.onRecordStart();
      control.elapsedTime = 0;
      timing = $interval(function () {
        ++control.elapsedTime;
        if (control.timeLimit && control.timeLimit > 0 && control.elapsedTime >= control.timeLimit) {
          control.stopRecord();
        }
      }, 1000);
    };

    if (recorderService.isCordova || recordHandler) {
      start();
    } else if (!status.isDenied) {
      //probably permission was never asked
      recorderService.showPermission({
        onDenied: function () {
          status.isDenied = true;
          $scope.$apply();
        },
        onAllowed: function () {
          status.isDenied = false;
          recordHandler = recorderService.getHandler();
          start();
          scopeApply();
        }
      });
    }
  };

  control.stopRecord = function () {
    var id = control.id;
    if (!recorderService.isAvailable() || !status.isRecording) {
      return false;
    }

    var recordHandler = recorderService.getHandler();
    var completed = function (blob) {
      $interval.cancel(timing);
      status.isRecording = false;
      var finalize = function (inputBlob) {
        control.audioModel = inputBlob;
        embedPlayer(inputBlob);
      };

      if (shouldConvertToMp3) {
        doMp3Conversion(blob, finalize);
      } else {
        finalize(blob)
      }

      embedPlayer(null);
      control.onRecordComplete();
    };

    //To stop recording
    if (recorderService.isCordova) {
      cordovaMedia.recorder.stopRecord();
      window.resolveLocalFileSystemURL(cordovaMedia.url, function (entry) {
        entry.file(function (blob) {
          completed(blob);
        });
      }, function (err) {
        console.log('Could not retrieve file, error code:', err.code);
      });
    } else if (recorderService.isHtml5) {
      recordHandler.stop();
      recordHandler.getBuffer(function () {
        recordHandler.exportWAV(function (blob) {
          completed(blob);
          scopeApply();
        });
      });
    } else {
      recordHandler.stopRecording(id);
      completed(recordHandler.getBlob(id));
    }
  };

  control.playbackRecording = function () {
    if (status.isPlaying || !recorderService.isAvailable() || status.isRecording || !control.audioModel) {
      return false;
    }

    if (recorderService.isCordova) {
      cordovaMedia.player = new Media(cordovaMedia.url, playbackOnEnded, function () {
        console.log('Playback failed');
      });
      cordovaMedia.player.play();
      playbackOnStart();
    } else {
      control.getAudioPlayer().play();
    }

  };

  control.playbackPause = function () {
    if (!status.isPlaying || !recorderService.isAvailable() || status.isRecording || !control.audioModel) {
      return false;
    }

    control.getAudioPlayer().pause();
    if (recorderService.isCordova) {
      playbackOnPause();
    }
  };

  control.playbackResume = function () {
    if (status.isPlaying || !recorderService.isAvailable() || status.isRecording || !control.audioModel) {
      return false;
    }

    if (status.isPaused) {
      //previously paused, just resume
      control.getAudioPlayer().play();
      if (recorderService.isCordova) {
        playbackOnResume();
      }
    } else {
      control.playbackRecording();
    }

  };


  control.save = function (fileName) {
    if (!recorderService.isAvailable() || status.isRecording || !control.audioModel) {
      return false;
    }

    if (!fileName) {
      fileName = 'audio_recording_' + control.id + (control.audioModel.type.indexOf('mp3') > -1 ? 'mp3' : 'wav');
    }

    var blobUrl = window.URL.createObjectURL(control.audioModel);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.target = '_blank';
    a.download = fileName;
    var click = document.createEvent("Event");
    click.initEvent("click", true, true);
    a.dispatchEvent(click);
  };

  control.isHtml5 = function () {
    return recorderService.isHtml5;
  };

  if (control.autoStart) {
    $timeout(function () {
      control.startRecord();
    }, 1000);
  }

  $element.on('$destroy', function () {
    $interval.cancel(timing);
  });

};

angular.module('angularAudioRecorder.controllers')
  .controller('recorderController', ['$element', 'recorderService', 'recorderUtils', '$scope', '$timeout', '$interval', 'recorderPlaybackStatus', RecorderController])
;
angular.module('angularAudioRecorder.directives', [
  'angularAudioRecorder.config',
  'angularAudioRecorder.services',
  'angularAudioRecorder.controllers'
]);
angular.module('angularAudioRecorder.directives')
  .directive('ngAudioRecorderAnalyzer', ['recorderService', 'recorderUtils',
    function (recorderService, recorderUtils) {

      var link = function (scope, element, attrs, recorder) {
        if (!recorderService.isHtml5) {
          scope.hide = true;
          return;
        }

        var canvasWidth, canvasHeight, rafID, analyserContext, props = recorderService.$html5AudioProps;

        function updateAnalysers(time) {

          if (!analyserContext) {
            var canvas = element.find("canvas")[0];

            if (attrs.width && !isNaN(attrs.width)) {
              canvas.width = attrs.width;
            }

            if (attrs.height && !isNaN(attrs.height)) {
              canvas.height = parseInt(attrs.height);
            }

            canvasWidth = canvas.width;
            canvasHeight = canvas.height;
            analyserContext = canvas.getContext('2d');
          }

          // analyzer draw code here
          {
            var SPACING = 3;
            var BAR_WIDTH = 1;
            var numBars = Math.round(canvasWidth / SPACING);
            var freqByteData = new Uint8Array(props.analyserNode.frequencyBinCount);

            props.analyserNode.getByteFrequencyData(freqByteData);

            analyserContext.clearRect(0, 0, canvasWidth, canvasHeight);
            //analyserContext.fillStyle = '#F6D565';
            analyserContext.lineCap = 'round';
            var multiplier = props.analyserNode.frequencyBinCount / numBars;

            // Draw rectangle for each frequency bin.
            for (var i = 0; i < numBars; ++i) {
              var magnitude = 0;
              var offset = Math.floor(i * multiplier);
              // gotta sum/average the block, or we miss narrow-bandwidth spikes
              for (var j = 0; j < multiplier; j++)
                magnitude += freqByteData[offset + j];
              magnitude = magnitude / multiplier;
              var magnitude2 = freqByteData[i * multiplier];
              if (attrs.waveColor)
                analyserContext.fillStyle = attrs.waveColor;
              else
                analyserContext.fillStyle = "hsl( " + Math.round((i * 360) / numBars) + ", 100%, 50%)";
              analyserContext.fillRect(i * SPACING, canvasHeight, BAR_WIDTH, -magnitude);
            }
          }

          rafID = window.requestAnimationFrame(updateAnalysers);
        }

        function cancelAnalyserUpdates() {
          window.cancelAnimationFrame(rafID);
          rafID = null;
        }

        element.on('$destroy', function () {
          cancelAnalyserUpdates();
        });

        recorder.onRecordStart = (function (original) {
          return function () {
            original.apply();
            updateAnalysers();
          };
        })(recorder.onRecordStart);

        recorderUtils.appendActionToCallback(recorder, 'onRecordStart', updateAnalysers, 'analyzer');
        recorderUtils.appendActionToCallback(recorder, 'onRecordComplete', cancelAnalyserUpdates, 'analyzer');
      };

      return {
        restrict: 'E',
        require: '^ngAudioRecorder',
        template: '<div ng-if="!hide" class="audioRecorder-analyzer">' +
        '<canvas class="analyzer" width="1200" height="400" style="max-width: 100%;"></canvas>' +
        '</div>',
        link: link
      };

    }
  ]);
angular.module('angularAudioRecorder.directives')
  .directive('ngAudioRecorderWaveView', ['recorderUtils', '$log',
    function (recorderUtils, $log) {

      return {
        restrict: 'E',
        require: '^ngAudioRecorder',
        link: function (scope, $element, attrs, recorder) {
          if (!window.WaveSurfer) {
            $log.warn('WaveSurfer was found.');
            return;
          }

          var audioPlayer;
          $element.html('<div class="waveSurfer"></div>');
          var options = angular.extend({container: $element.find('div')[0]}, attrs);
          var waveSurfer = WaveSurfer.create(options);
          waveSurfer.setVolume(0);
          recorderUtils.appendActionToCallback(recorder, 'onPlaybackStart|onPlaybackResume', function () {
            waveSurfer.play();
          }, 'waveView');
          recorderUtils.appendActionToCallback(recorder, 'onPlaybackComplete|onPlaybackPause', function () {
            waveSurfer.pause();
          }, 'waveView');

          recorderUtils.appendActionToCallback(recorder, 'onRecordComplete', function () {
            if (!audioPlayer) {
              audioPlayer = recorder.getAudioPlayer();
              audioPlayer.addEventListener('seeking', function (e) {
                var progress = audioPlayer.currentTime / audioPlayer.duration;
                waveSurfer.seekTo(progress);
              });
            }
          }, 'waveView');


          scope.$watch(function () {
            return recorder.audioModel;
          }, function (newBlob) {
            if (newBlob instanceof Blob) {
              waveSurfer.loadBlob(newBlob);
            }
          });
        }
      };
    }]);
angular.module('angularAudioRecorder.directives')
  .directive('ngAudioRecorder', ['recorderService', '$timeout',
    function (recorderService, $timeout) {
      return {
        restrict: 'EA',
        scope: {
          audioModel: '=',
          id: '@',
          onRecordStart: '&',
          onRecordComplete: '&',
          onPlaybackComplete: '&',
          onPlaybackStart: '&',
          onPlaybackPause: '&',
          onPlaybackResume: '&',
          onConversionStart: '&',
          onConversionComplete: '&',
          showPlayer: '=?',
          autoStart: '=?',
          convertMp3: '=?',
          timeLimit: '=?'
        },
        controllerAs: 'recorder',
        bindToController: true,
        template: function (element, attrs) {
          return '<div class="audioRecorder">' +
            '<div style="width: 250px; margin: 0 auto;"><div id="audioRecorder-fwrecorder"></div></div>' +
            element.html() +
            '</div>';
        },
        controller: 'recorderController',
        link: function (scope, element, attrs) {
          $timeout(function () {
            if (recorderService.isAvailable && !(recorderService.isHtml5 || recorderService.isCordova)) {
              var params = {
                'allowscriptaccess': 'always'
              }, attrs = {
                'id': 'recorder-app',
                'name': 'recorder-app'
              }, flashVars = {
                'save_text': ''
              };
              swfobject.embedSWF(recorderService.getSwfUrl(), "audioRecorder-fwrecorder", "0", "0", "11.0.0", "", flashVars, params, attrs);
            }
          }, 100);

        }
      };
    }
  ]);

angular.module('angularAudioRecorder.services', ['angularAudioRecorder.config']);
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
angular.module('angularAudioRecorder.services')
  .factory('recorderUtils', [
    /**
     * @ngdoc service
     * @name recorderUtils
     *
     */
      function () {

      // Generates UUID
      var factory = {
        generateUuid: function () {
          function _p8(s) {
            var p = (Math.random().toString(16) + "000000000").substr(2, 8);
            return s ? "-" + p.substr(0, 4) + "-" + p.substr(4, 4) : p;
          }

          return _p8() + _p8(true) + _p8(true) + _p8();
        },
        cordovaAudioUrl: function (id) {
          if (!window.cordova) {
            return 'record-audio' + id + '.wav';
          }

          var url = cordova.file.tempDirectory
            || cordova.file.externalApplicationStorageDirectory
            || cordova.file.sharedDirectory;

          url += Date.now() + '_recordedAudio_' + id.replace('/[^A-Za-z0-9_-]+/gi', '-');
          switch (window.cordova.platformId) {
            case 'ios':
              url += '.wav';
              break;

            case 'android':
              url += '.amr';
              break;

            case 'wp':
              url += '.wma';
              break;

            default :
              url += '.mp3';
          }

          return url;
        }
      };

      factory.appendActionToCallback = function (object, callbacks, action, track) {

        callbacks.split(/\|/).forEach(function (callback) {
          if (!angular.isObject(object) || !angular.isFunction(action) || !(callback in object) || !angular.isFunction(object[callback])) {
            throw new Error('One or more parameter supplied is not valid');
          }
          ;

          if (!('$$appendTrackers' in object)) {
            object.$$appendTrackers = [];
          }

          var tracker = callback + '|' + track;
          if (object.$$appendTrackers.indexOf(tracker) > -1) {
            console.log('Already appended: ', tracker);
            return;
          }

          object[callback] = (function (original) {
            return function () {
              //console.trace('Calling Callback : ', tracker);
              original.apply(object, arguments);
              action.apply(object, arguments);
            };
          })(object[callback]);

          object.$$appendTrackers.push(tracker);
        });
      };

      return factory;
    }
  ]);})();
(function (global) {
  'use strict';

  var Recorder, RECORDED_AUDIO_TYPE = "audio/wav";

  Recorder = {
    recorder: null,
    recorderOriginalWidth: 0,
    recorderOriginalHeight: 0,
    uploadFormId: null,
    uploadFieldName: null,
    isReady: false,

    connect: function (name, attempts) {
      if (navigator.appName.indexOf("Microsoft") != -1) {
        Recorder.recorder = window[name];
      } else {
        Recorder.recorder = document[name];
      }

      if (attempts >= 40) {
        return;
      }

      // flash app needs time to load and initialize
      if (Recorder.recorder && Recorder.recorder.init) {
        Recorder.recorderOriginalWidth = Recorder.recorder.width;
        Recorder.recorderOriginalHeight = Recorder.recorder.height;
        if (Recorder.uploadFormId && $) {
          var frm = $(Recorder.uploadFormId);
          Recorder.recorder.init(frm.attr('action').toString(), Recorder.uploadFieldName, frm.serializeArray());
        }
        return;
      }

      setTimeout(function () {
        Recorder.connect(name, attempts + 1);
      }, 100);
    },

    playBack: function (name) {
      // TODO: Rename to `playback`
      Recorder.recorder.playBack(name);
    },

    pausePlayBack: function (name) {
      // TODO: Rename to `pausePlayback`
      Recorder.recorder.pausePlayBack(name);
    },

    playBackFrom: function (name, time) {
      // TODO: Rename to `playbackFrom`
      Recorder.recorder.playBackFrom(name, time);
    },

    record: function (name, filename) {
      Recorder.recorder.record(name, filename);
    },

    stopRecording: function () {
      Recorder.recorder.stopRecording();
    },

    stopPlayBack: function () {
      // TODO: Rename to `stopPlayback`
      Recorder.recorder.stopPlayBack();
    },

    observeLevel: function () {
      Recorder.recorder.observeLevel();
    },

    stopObservingLevel: function () {
      Recorder.recorder.stopObservingLevel();
    },

    observeSamples: function () {
      Recorder.recorder.observeSamples();
    },

    stopObservingSamples: function () {
      Recorder.recorder.stopObservingSamples();
    },

    resize: function (width, height) {
      Recorder.recorder.width = width + "px";
      Recorder.recorder.height = height + "px";
    },

    defaultSize: function () {
      Recorder.resize(Recorder.recorderOriginalWidth, Recorder.recorderOriginalHeight);
    },

    show: function () {
      Recorder.recorder.show();
    },

    hide: function () {
      Recorder.recorder.hide();
    },

    duration: function (name) {
      // TODO: rename to `getDuration`
      return Recorder.recorder.duration(name || Recorder.uploadFieldName);
    },

    getBase64: function (name) {
      var data = Recorder.recorder.getBase64(name);
      return 'data:' + RECORDED_AUDIO_TYPE + ';base64,' + data;
    },

    getBlob: function (name) {
      var base64Data = Recorder.getBase64(name).split(',')[1];
      return base64toBlob(base64Data, RECORDED_AUDIO_TYPE);
    },

    getCurrentTime: function (name) {
      return Recorder.recorder.getCurrentTime(name);
    },

    isMicrophoneAccessible: function () {
      return Recorder.recorder.isMicrophoneAccessible();
    },

    updateForm: function () {
      var frm = $(Recorder.uploadFormId);
      Recorder.recorder.update(frm.serializeArray());
    },

    showPermissionWindow: function (options) {
      Recorder.resize(240, 160);
      // need to wait until app is resized before displaying permissions screen
      var permissionCommand = function () {
        if (options && options.permanent) {
          Recorder.recorder.permitPermanently();
        } else {
          Recorder.recorder.permit();
        }
      };
      setTimeout(permissionCommand, 1);
    },

    configure: function (rate, gain, silenceLevel, silenceTimeout) {
      rate = parseInt(rate || 22);
      gain = parseInt(gain || 100);
      silenceLevel = parseInt(silenceLevel || 0);
      silenceTimeout = parseInt(silenceTimeout || 4000);
      switch (rate) {
        case 44:
        case 22:
        case 11:
        case 8:
        case 5:
          break;
        default:
          throw("invalid rate " + rate);
      }

      if (gain < 0 || gain > 100) {
        throw("invalid gain " + gain);
      }

      if (silenceLevel < 0 || silenceLevel > 100) {
        throw("invalid silenceLevel " + silenceLevel);
      }

      if (silenceTimeout < -1) {
        throw("invalid silenceTimeout " + silenceTimeout);
      }

      Recorder.recorder.configure(rate, gain, silenceLevel, silenceTimeout);
    },

    setUseEchoSuppression: function (val) {
      if (typeof(val) != 'boolean') {
        throw("invalid value for setting echo suppression, val: " + val);
      }

      Recorder.recorder.setUseEchoSuppression(val);
    },

    setLoopBack: function (val) {
      if (typeof(val) != 'boolean') {
        throw("invalid value for setting loop back, val: " + val);
      }

      Recorder.recorder.setLoopBack(val);
    }
  };

  function base64toBlob(b64Data, contentType, sliceSize) {
    contentType = contentType || '';
    sliceSize = sliceSize || 512;

    var byteCharacters = atob(b64Data);
    var byteArrays = [];

    for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      var slice = byteCharacters.slice(offset, offset + sliceSize);

      var byteNumbers = new Array(slice.length);
      for (var i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      var byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, {type: contentType});
  }


  global.FWRecorder = Recorder;


})(window);
/**
 * This script adds a new function to a function prototype,
 * which allows a function to be converted to a web worker.
 *
 * Please note that this method copies the function's source code into a Blob, so references to variables
 * outside the function's own scope will be invalid.
 *
 * You can however pass variables that can be serialized into JSON, to this function using the params parameter
 *
 * @usage
 * ```
 * myFunction.toWorker({param1: p1, param2: p2...})
 *```
 *
 */
(function () {
  'use strict';


  var workerToBlobUrl = function (fn, params) {
    if (typeof fn !== 'function') {
      throw("The specified parameter must be a valid function");
    }
    var fnString = fn.toString();
    if (fnString.match(/\[native\s*code\]/i)) {
      throw("You cannot bind a native function to a worker");
    }
    ;

    params = params || {};
    if (typeof params !== 'object') {
      console.warn('Params must be an object that is serializable with JSON.stringify, specified is: ' + (typeof params));
    }

    var blobURL = window.URL.createObjectURL(new Blob(['(', fnString, ')(this,', JSON.stringify(params), ')'], {type: 'application/javascript'}));

    return blobURL;
  };

  Function.prototype.toWorker = function (params) {
    var url = workerToBlobUrl(this, params);
    return new Worker(url);
  };
})();
/*License (MIT)

 Copyright © 2013 Matt Diamond

 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 to permit persons to whom the Software is furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 DEALINGS IN THE SOFTWARE.
 */

(function (win) {
  'use strict';

  var RecorderWorker = function (me) {
    var recLength = 0,
      recBuffersL = [],
      recBuffersR = [],
      bits = 16,
      sampleRate;

    me.onmessage = function (e) {
      switch (e.data.command) {
        case 'init':
          init(e.data.config);
          break;
        case 'record':
          record(e.data.buffer);
          break;
        case 'exportWAV':
          exportWAV(e.data.type);
          break;
        case 'getBuffer':
          getBuffer();
          break;
        case 'clear':
          clear();
          break;
      }
    };

    function init(config) {
      sampleRate = config.sampleRate;
    }

    function record(inputBuffer) {
      recBuffersL.push(inputBuffer[0]);
      //recBuffersR.push(inputBuffer[1]);
      recLength += inputBuffer[0].length;
    }

    function exportWAV(type) {
      var bufferL = mergeBuffers(recBuffersL, recLength);
      var dataview = encodeWAV(bufferL);
      var audioBlob = new Blob([dataview], {type: type});

      me.postMessage(audioBlob);
    }

    function getBuffer() {
      var buffers = [];
      buffers.push(mergeBuffers(recBuffersL, recLength));
      buffers.push(mergeBuffers(recBuffersR, recLength));
      me.postMessage(buffers);
    }

    function clear() {
      recLength = 0;
      recBuffersL = [];
      recBuffersR = [];
    }

    function mergeBuffers(recBuffers, recLength) {
      var result = new Float32Array(recLength);
      var offset = 0;
      for (var i = 0; i < recBuffers.length; i++) {
        result.set(recBuffers[i], offset);
        offset += recBuffers[i].length;
      }
      return result;
    }

    //function interleave(inputL, inputR) {
    //  var length = inputL.length + inputR.length;
    //  var result = new Float32Array(length);
    //
    //  var index = 0,
    //    inputIndex = 0;
    //
    //  while (index < length) {
    //    result[index++] = inputL[inputIndex];
    //    result[index++] = inputR[inputIndex];
    //    inputIndex++;
    //  }
    //  return result;
    //}

    function floatTo16BitPCM(output, offset, input) {
      for (var i = 0; i < input.length; i++, offset += 2) {
        var s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
    }

    function writeString(view, offset, string) {
      for (var i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }


    function encodeWAV(samples) {
      var buffer = new ArrayBuffer(44 + samples.length * 2);
      var view = new DataView(buffer);

      /* RIFF identifier */
      writeString(view, 0, 'RIFF');
      /* file length */
      view.setUint32(4, 32 + samples.length * 2, true);
      /* RIFF type */
      writeString(view, 8, 'WAVE');
      /* format chunk identifier */
      writeString(view, 12, 'fmt ');
      /* format chunk length */
      view.setUint32(16, 16, true);
      /* sample format (raw) */
      view.setUint16(20, 1, true);
      /* channel count */
      //view.setUint16(22, 2, true); /*STEREO*/
      view.setUint16(22, 1, true);
      /*MONO*/
      /* sample rate */
      view.setUint32(24, sampleRate, true);
      /* byte rate (sample rate * block align) */
      //view.setUint32(28, sampleRate * 4, true); /*STEREO*/
      view.setUint32(28, sampleRate * 2, true);
      /*MONO*/
      /* block align (channel count * bytes per sample) */
      //view.setUint16(32, 4, true); /*STEREO*/
      view.setUint16(32, 2, true);
      /*MONO*/
      /* bits per sample */
      view.setUint16(34, 16, true);
      /* data chunk identifier */
      writeString(view, 36, 'data');
      /* data chunk length */
      view.setUint32(40, samples.length * 2, true);

      floatTo16BitPCM(view, 44, samples);

      return view;
    }
  };

  var Recorder = function (source, cfg) {
    var config = cfg || {};
    var bufferLen = config.bufferLen || 4096;
    this.context = source.context;
    this.node = (this.context.createScriptProcessor ||
    this.context.createJavaScriptNode).call(this.context,
      bufferLen, 2, 2);
    var worker = RecorderWorker.toWorker();
    worker.postMessage({
      command: 'init',
      config: {
        sampleRate: this.context.sampleRate
      }
    });
    var recording = false,
      currCallback;

    this.node.onaudioprocess = function (e) {
      if (!recording) return;
      worker.postMessage({
        command: 'record',
        buffer: [
          e.inputBuffer.getChannelData(0),
        ]
      });
    };

    this.configure = function (cfg) {
      for (var prop in cfg) {
        if (cfg.hasOwnProperty(prop)) {
          config[prop] = cfg[prop];
        }
      }
    };

    this.record = function () {
      recording = true;
    };

    this.stop = function () {
      recording = false;
    };

    this.clear = function () {
      worker.postMessage({command: 'clear'});
    };

    this.getBuffer = function (cb) {
      currCallback = cb || config.callback;
      worker.postMessage({command: 'getBuffer'})
    };

    this.exportWAV = function (cb, type) {
      currCallback = cb || config.callback;
      type = type || config.type || 'audio/wav';
      if (!currCallback) throw new Error('Callback not set');
      worker.postMessage({
        command: 'exportWAV',
        type: type
      });
    };

    worker.onmessage = function (e) {
      var blob = e.data;
      //console.log("the blob " +  blob + " " + blob.size + " " + blob.type);
      currCallback(blob);
    };


    source.connect(this.node);
    this.node.connect(this.context.destination);    //this should not be necessary
  };

  win.Recorder = Recorder;
})(window);

(function (win) {
  'use strict';

  var MP3ConversionWorker = function (me, params) {
    //should not reference any variable in parent scope as it will executed in its
    //on isolated scope
    console.log('MP3 conversion worker started.');
    if (typeof lamejs === 'undefined') {
      importScripts(params.lameJsUrl);
    }

    var mp3Encoder, maxSamples = 1152, wav, samples, lame, config, dataBuffer;


    var clearBuffer = function () {
      dataBuffer = [];
    };

    var appendToBuffer = function (mp3Buf) {
      dataBuffer.push(new Int8Array(mp3Buf));
    };


    var init = function (prefConfig) {
      config = prefConfig || {};
      lame = new lamejs();
      clearBuffer();
    };

    var encode = function (arrayBuffer) {
      wav = lame.WavHeader.readHeader(new DataView(arrayBuffer));
      console.log('wave:', wav);
      samples = new Int16Array(arrayBuffer, wav.dataOffset, wav.dataLen / 2);
      mp3Encoder = new lame.Mp3Encoder(wav.channels, wav.sampleRate, config.bitRate || 128);

      var remaining = samples.length;
      for (var i = 0; remaining >= maxSamples; i += maxSamples) {
        var mono = samples.subarray(i, i + maxSamples);
        var mp3buf = mp3Encoder.encodeBuffer(mono);
        appendToBuffer(mp3buf);
        remaining -= maxSamples;
      }
    };

    var finish = function () {
      var mp3buf = mp3Encoder.flush();
      appendToBuffer(mp3buf);
      self.postMessage({cmd: 'end', buf: dataBuffer});
      console.log('done encoding');
      clearBuffer();//free up memory
    };

    me.onmessage = function (e) {
      switch (e.data.cmd) {
        case 'init':
          init(e.data.config);
          break;

        case 'encode':
          encode(e.data.rawInput);
          break;

        case 'finish':
          finish();
          break;
      }
    };
  };

  var SCRIPT_BASE = (function () {
    var scripts = document.getElementsByTagName('script');
    var myUrl = scripts[scripts.length - 1].getAttribute('src');
    var path = myUrl.substr(0, myUrl.lastIndexOf('/') + 1);
    if (path && !path.match(/:\/\//)) {
      var a = document.createElement('a');
      a.href = path;
      return a.href;
    }
    return path;
  }());

  var MP3Converter = function (config) {

    config = config || {};
    config.lameJsUrl = config.lameJsUrl || (SCRIPT_BASE + '/lame.min.js');
    var busy = false;
    var mp3Worker = MP3ConversionWorker.toWorker(config);

    this.isBusy = function () {
      return busy
    };

    this.convert = function (blob) {
      var conversionId = 'conversion_' + Date.now(),
        tag = conversionId + ":"
        ;
      console.log(tag, 'Starting conversion');
      var preferredConfig = {}, onSuccess, onError;
      switch (typeof arguments[1]) {
        case 'object':
          preferredConfig = arguments[1];
          break;
        case 'function':
          onSuccess = arguments[1];
          break;
        default:
          throw "parameter 2 is expected to be an object (config) or function (success callback)"
      }

      if (typeof arguments[2] === 'function') {
        if (onSuccess) {
          onError = arguments[2];
        } else {
          onSuccess = arguments[2];
        }
      }

      if (typeof arguments[3] === 'function' && !onError) {
        onError = arguments[3];
      }

      if (busy) {
        throw ("Another conversion is in progress");
      }

      var initialSize = blob.size,
        fileReader = new FileReader(),
        startTime = Date.now();

      fileReader.onload = function (e) {
        console.log(tag, "Passed to BG process");
        mp3Worker.postMessage({
          cmd: 'init',
          config: preferredConfig
        });

        mp3Worker.postMessage({cmd: 'encode', rawInput: e.target.result});
        mp3Worker.postMessage({cmd: 'finish'});

        mp3Worker.onmessage = function (e) {
          if (e.data.cmd == 'end') {
            console.log(tag, "Done converting to Mp3");
            var mp3Blob = new Blob(e.data.buf, {type: 'audio/mp3'});
            console.log(tag, "Conversion completed in: " + ((Date.now() - startTime) / 1000) + 's');
            var finalSize = mp3Blob.size;
            console.log(tag +
              "Initial size: = " + initialSize + ", " +
              "Final size = " + finalSize
              + ", Reduction: " + Number((100 * (initialSize - finalSize) / initialSize)).toPrecision(4) + "%");

            busy = false;
            if (onSuccess && typeof onSuccess === 'function') {
              onSuccess(mp3Blob);
            }
          }
        };
      };
      busy = true;
      fileReader.readAsArrayBuffer(blob);
    }
  };

  win.MP3Converter = MP3Converter;
})(window);
(function (win) {
  'use strict';

  /*!SWFObject v2.1 <http://code.google.com/p/swfobject/>
   Copyright (c) 2007-2008 Geoff Stearns, Michael Williams, and Bobby van der Sluis
   This software is released under the MIT License <http://www.opensource.org/licenses/mit-license.php>
   */
  win.swfobject = function () {

    var UNDEF = "undefined",
      OBJECT = "object",
      SHOCKWAVE_FLASH = "Shockwave Flash",
      SHOCKWAVE_FLASH_AX = "ShockwaveFlash.ShockwaveFlash",
      FLASH_MIME_TYPE = "application/x-shockwave-flash",
      EXPRESS_INSTALL_ID = "SWFObjectExprInst",

      win = window,
      doc = document,
      nav = navigator,

      domLoadFnArr = [],
      regObjArr = [],
      objIdArr = [],
      listenersArr = [],
      script,
      timer = null,
      storedAltContent = null,
      storedAltContentId = null,
      isDomLoaded = false,
      isExpressInstallActive = false;

    /* Centralized function for browser feature detection
     - Proprietary feature detection (conditional compiling) is used to detect Internet Explorer's features
     - User agent string detection is only used when no alternative is possible
     - Is executed directly for optimal performance
     */
    var ua = function () {
      var w3cdom = typeof doc.getElementById != UNDEF && typeof doc.getElementsByTagName != UNDEF && typeof doc.createElement != UNDEF,
        playerVersion = [0, 0, 0],
        d = null;
      if (typeof nav.plugins != UNDEF && typeof nav.plugins[SHOCKWAVE_FLASH] == OBJECT) {
        d = nav.plugins[SHOCKWAVE_FLASH].description;
        if (d && !(typeof nav.mimeTypes != UNDEF && nav.mimeTypes[FLASH_MIME_TYPE] && !nav.mimeTypes[FLASH_MIME_TYPE].enabledPlugin)) { // navigator.mimeTypes["application/x-shockwave-flash"].enabledPlugin indicates whether plug-ins are enabled or disabled in Safari 3+
          d = d.replace(/^.*\s+(\S+\s+\S+$)/, "$1");
          playerVersion[0] = parseInt(d.replace(/^(.*)\..*$/, "$1"), 10);
          playerVersion[1] = parseInt(d.replace(/^.*\.(.*)\s.*$/, "$1"), 10);
          playerVersion[2] = /r/.test(d) ? parseInt(d.replace(/^.*r(.*)$/, "$1"), 10) : 0;
        }
      }
      else if (typeof win.ActiveXObject != UNDEF) {
        var a = null, fp6Crash = false;
        try {
          a = new ActiveXObject(SHOCKWAVE_FLASH_AX + ".7");
        }
        catch (e) {
          try {
            a = new ActiveXObject(SHOCKWAVE_FLASH_AX + ".6");
            playerVersion = [6, 0, 21];
            a.AllowScriptAccess = "always";	 // Introduced in fp6.0.47
          }
          catch (e) {
            if (playerVersion[0] == 6) {
              fp6Crash = true;
            }
          }
          if (!fp6Crash) {
            try {
              a = new ActiveXObject(SHOCKWAVE_FLASH_AX);
            }
            catch (e) {
            }
          }
        }
        if (!fp6Crash && a) { // a will return null when ActiveX is disabled
          try {
            d = a.GetVariable("$version");	// Will crash fp6.0.21/23/29
            if (d) {
              d = d.split(" ")[1].split(",");
              playerVersion = [parseInt(d[0], 10), parseInt(d[1], 10), parseInt(d[2], 10)];
            }
          }
          catch (e) {
          }
        }
      }
      var u = nav.userAgent.toLowerCase(),
        p = nav.platform.toLowerCase(),
        webkit = /webkit/.test(u) ? parseFloat(u.replace(/^.*webkit\/(\d+(\.\d+)?).*$/, "$1")) : false, // returns either the webkit version or false if not webkit
        ie = false,
        windows = p ? /win/.test(p) : /win/.test(u),
        mac = p ? /mac/.test(p) : /mac/.test(u);
      /*@cc_on
       ie = true;
       @if (@_win32)
       windows = true;
       @elif (@_mac)
       mac = true;
       @end
       @*/
      return {w3cdom: w3cdom, pv: playerVersion, webkit: webkit, ie: ie, win: windows, mac: mac};
    }();

    /* Cross-browser onDomLoad
     - Based on Dean Edwards' solution: http://dean.edwards.name/weblog/2006/06/again/
     - Will fire an event as soon as the DOM of a page is loaded (supported by Gecko based browsers - like Firefox -, IE, Opera9+, Safari)
     */
    var onDomLoad = function () {
      if (!ua.w3cdom) {
        return;
      }
      addDomLoadEvent(main);
      if (ua.ie && ua.win) {
        try {	 // Avoid a possible Operation Aborted error
          doc.write("<scr" + "ipt id=__ie_ondomload defer=true src=//:></scr" + "ipt>"); // String is split into pieces to avoid Norton AV to add code that can cause errors
          script = getElementById("__ie_ondomload");
          if (script) {
            addListener(script, "onreadystatechange", checkReadyState);
          }
        }
        catch (e) {
        }
      }
      if (ua.webkit && typeof doc.readyState != UNDEF) {
        timer = setInterval(function () {
          if (/loaded|complete/.test(doc.readyState)) {
            callDomLoadFunctions();
          }
        }, 10);
      }
      if (typeof doc.addEventListener != UNDEF) {
        doc.addEventListener("DOMContentLoaded", callDomLoadFunctions, null);
      }
      addLoadEvent(callDomLoadFunctions);
    }();

    function checkReadyState() {
      if (script.readyState == "complete") {
        script.parentNode.removeChild(script);
        callDomLoadFunctions();
      }
    }

    function callDomLoadFunctions() {
      if (isDomLoaded) {
        return;
      }
      if (ua.ie && ua.win) { // Test if we can really add elements to the DOM; we don't want to fire it too early
        var s = createElement("span");
        try { // Avoid a possible Operation Aborted error
          var t = doc.getElementsByTagName("body")[0].appendChild(s);
          t.parentNode.removeChild(t);
        }
        catch (e) {
          return;
        }
      }
      isDomLoaded = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      var dl = domLoadFnArr.length;
      for (var i = 0; i < dl; i++) {
        domLoadFnArr[i]();
      }
    }

    function addDomLoadEvent(fn) {
      if (isDomLoaded) {
        fn();
      }
      else {
        domLoadFnArr[domLoadFnArr.length] = fn; // Array.push() is only available in IE5.5+
      }
    }

    /* Cross-browser onload
     - Based on James Edwards' solution: http://brothercake.com/site/resources/scripts/onload/
     - Will fire an event as soon as a web page including all of its assets are loaded
     */
    function addLoadEvent(fn) {
      if (typeof win.addEventListener != UNDEF) {
        win.addEventListener("load", fn, false);
      }
      else if (typeof doc.addEventListener != UNDEF) {
        doc.addEventListener("load", fn, false);
      }
      else if (typeof win.attachEvent != UNDEF) {
        addListener(win, "onload", fn);
      }
      else if (typeof win.onload == "function") {
        var fnOld = win.onload;
        win.onload = function () {
          fnOld();
          fn();
        };
      }
      else {
        win.onload = fn;
      }
    }

    /* Main function
     - Will preferably execute onDomLoad, otherwise onload (as a fallback)
     */
    function main() { // Static publishing only
      var rl = regObjArr.length;
      for (var i = 0; i < rl; i++) { // For each registered object element
        var id = regObjArr[i].id;
        if (ua.pv[0] > 0) {
          var obj = getElementById(id);
          if (obj) {
            regObjArr[i].width = obj.getAttribute("width") ? obj.getAttribute("width") : "0";
            regObjArr[i].height = obj.getAttribute("height") ? obj.getAttribute("height") : "0";
            if (hasPlayerVersion(regObjArr[i].swfVersion)) { // Flash plug-in version >= Flash content version: Houston, we have a match!
              if (ua.webkit && ua.webkit < 312) { // Older webkit engines ignore the object element's nested param elements
                fixParams(obj);
              }
              setVisibility(id, true);
            }
            else if (regObjArr[i].expressInstall && !isExpressInstallActive && hasPlayerVersion("6.0.65") && (ua.win || ua.mac)) { // Show the Adobe Express Install dialog if set by the web page author and if supported (fp6.0.65+ on Win/Mac OS only)
              showExpressInstall(regObjArr[i]);
            }
            else { // Flash plug-in and Flash content version mismatch: display alternative content instead of Flash content
              displayAltContent(obj);
            }
          }
        }
        else {	// If no fp is installed, we let the object element do its job (show alternative content)
          setVisibility(id, true);
        }
      }
    }

    /* Fix nested param elements, which are ignored by older webkit engines
     - This includes Safari up to and including version 1.2.2 on Mac OS 10.3
     - Fall back to the proprietary embed element
     */
    function fixParams(obj) {
      var nestedObj = obj.getElementsByTagName(OBJECT)[0];
      if (nestedObj) {
        var e = createElement("embed"), a = nestedObj.attributes;
        if (a) {
          var al = a.length;
          for (var i = 0; i < al; i++) {
            if (a[i].nodeName == "DATA") {
              e.setAttribute("src", a[i].nodeValue);
            }
            else {
              e.setAttribute(a[i].nodeName, a[i].nodeValue);
            }
          }
        }
        var c = nestedObj.childNodes;
        if (c) {
          var cl = c.length;
          for (var j = 0; j < cl; j++) {
            if (c[j].nodeType == 1 && c[j].nodeName == "PARAM") {
              e.setAttribute(c[j].getAttribute("name"), c[j].getAttribute("value"));
            }
          }
        }
        obj.parentNode.replaceChild(e, obj);
      }
    }

    /* Show the Adobe Express Install dialog
     - Reference: http://www.adobe.com/cfusion/knowledgebase/index.cfm?id=6a253b75
     */
    function showExpressInstall(regObj) {
      isExpressInstallActive = true;
      var obj = getElementById(regObj.id);
      if (obj) {
        if (regObj.altContentId) {
          var ac = getElementById(regObj.altContentId);
          if (ac) {
            storedAltContent = ac;
            storedAltContentId = regObj.altContentId;
          }
        }
        else {
          storedAltContent = abstractAltContent(obj);
        }
        if (!(/%$/.test(regObj.width)) && parseInt(regObj.width, 10) < 310) {
          regObj.width = "310";
        }
        if (!(/%$/.test(regObj.height)) && parseInt(regObj.height, 10) < 137) {
          regObj.height = "137";
        }
        doc.title = doc.title.slice(0, 47) + " - Flash Player Installation";
        var pt = ua.ie && ua.win ? "ActiveX" : "PlugIn",
          dt = doc.title,
          fv = "MMredirectURL=" + win.location + "&MMplayerType=" + pt + "&MMdoctitle=" + dt,
          replaceId = regObj.id;
        // For IE when a SWF is loading (AND: not available in cache) wait for the onload event to fire to remove the original object element
        // In IE you cannot properly cancel a loading SWF file without breaking browser load references, also obj.onreadystatechange doesn't work
        if (ua.ie && ua.win && obj.readyState != 4) {
          var newObj = createElement("div");
          replaceId += "SWFObjectNew";
          newObj.setAttribute("id", replaceId);
          obj.parentNode.insertBefore(newObj, obj); // Insert placeholder div that will be replaced by the object element that loads expressinstall.swf
          obj.style.display = "none";
          var fn = function () {
            obj.parentNode.removeChild(obj);
          };
          addListener(win, "onload", fn);
        }
        createSWF({
          data: regObj.expressInstall,
          id: EXPRESS_INSTALL_ID,
          width: regObj.width,
          height: regObj.height
        }, {flashvars: fv}, replaceId);
      }
    }

    /* Functions to abstract and display alternative content
     */
    function displayAltContent(obj) {
      if (ua.ie && ua.win && obj.readyState != 4) {
        // For IE when a SWF is loading (AND: not available in cache) wait for the onload event to fire to remove the original object element
        // In IE you cannot properly cancel a loading SWF file without breaking browser load references, also obj.onreadystatechange doesn't work
        var el = createElement("div");
        obj.parentNode.insertBefore(el, obj); // Insert placeholder div that will be replaced by the alternative content
        el.parentNode.replaceChild(abstractAltContent(obj), el);
        obj.style.display = "none";
        var fn = function () {
          obj.parentNode.removeChild(obj);
        };
        addListener(win, "onload", fn);
      }
      else {
        obj.parentNode.replaceChild(abstractAltContent(obj), obj);
      }
    }

    function abstractAltContent(obj) {
      var ac = createElement("div");
      if (ua.win && ua.ie) {
        ac.innerHTML = obj.innerHTML;
      }
      else {
        var nestedObj = obj.getElementsByTagName(OBJECT)[0];
        if (nestedObj) {
          var c = nestedObj.childNodes;
          if (c) {
            var cl = c.length;
            for (var i = 0; i < cl; i++) {
              if (!(c[i].nodeType == 1 && c[i].nodeName == "PARAM") && !(c[i].nodeType == 8)) {
                ac.appendChild(c[i].cloneNode(true));
              }
            }
          }
        }
      }
      return ac;
    }

    /* Cross-browser dynamic SWF creation
     */
    function createSWF(attObj, parObj, id) {
      var r, el = getElementById(id);
      if (el) {
        if (typeof attObj.id == UNDEF) { // if no 'id' is defined for the object element, it will inherit the 'id' from the alternative content
          attObj.id = id;
        }
        if (ua.ie && ua.win) { // IE, the object element and W3C DOM methods do not combine: fall back to outerHTML
          var att = "";
          for (var i in attObj) {
            if (attObj[i] != Object.prototype[i]) { // Filter out prototype additions from other potential libraries, like Object.prototype.toJSONString = function() {}
              if (i.toLowerCase() == "data") {
                parObj.movie = attObj[i];
              }
              else if (i.toLowerCase() == "styleclass") { // 'class' is an ECMA4 reserved keyword
                att += ' class="' + attObj[i] + '"';
              }
              else if (i.toLowerCase() != "classid") {
                att += ' ' + i + '="' + attObj[i] + '"';
              }
            }
          }
          var par = "";
          for (var j in parObj) {
            if (parObj[j] != Object.prototype[j]) { // Filter out prototype additions from other potential libraries
              par += '<param name="' + j + '" value="' + parObj[j] + '" />';
            }
          }
          el.outerHTML = '<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000"' + att + '>' + par + '</object>';
          objIdArr[objIdArr.length] = attObj.id; // Stored to fix object 'leaks' on unload (dynamic publishing only)
          r = getElementById(attObj.id);
        }
        else if (ua.webkit && ua.webkit < 312) { // Older webkit engines ignore the object element's nested param elements: fall back to the proprietary embed element
          var e = createElement("embed");
          e.setAttribute("type", FLASH_MIME_TYPE);
          for (var k in attObj) {
            if (attObj[k] != Object.prototype[k]) { // Filter out prototype additions from other potential libraries
              if (k.toLowerCase() == "data") {
                e.setAttribute("src", attObj[k]);
              }
              else if (k.toLowerCase() == "styleclass") { // 'class' is an ECMA4 reserved keyword
                e.setAttribute("class", attObj[k]);
              }
              else if (k.toLowerCase() != "classid") { // Filter out IE specific attribute
                e.setAttribute(k, attObj[k]);
              }
            }
          }
          for (var l in parObj) {
            if (parObj[l] != Object.prototype[l]) { // Filter out prototype additions from other potential libraries
              if (l.toLowerCase() != "movie") { // Filter out IE specific param element
                e.setAttribute(l, parObj[l]);
              }
            }
          }
          el.parentNode.replaceChild(e, el);
          r = e;
        }
        else { // Well-behaving browsers
          var o = createElement(OBJECT);
          o.setAttribute("type", FLASH_MIME_TYPE);
          for (var m in attObj) {
            if (attObj[m] != Object.prototype[m]) { // Filter out prototype additions from other potential libraries
              if (m.toLowerCase() == "styleclass") { // 'class' is an ECMA4 reserved keyword
                o.setAttribute("class", attObj[m]);
              }
              else if (m.toLowerCase() != "classid") { // Filter out IE specific attribute
                o.setAttribute(m, attObj[m]);
              }
            }
          }
          for (var n in parObj) {
            if (parObj[n] != Object.prototype[n] && n.toLowerCase() != "movie") { // Filter out prototype additions from other potential libraries and IE specific param element
              createObjParam(o, n, parObj[n]);
            }
          }
          el.parentNode.replaceChild(o, el);
          r = o;
        }
      }
      return r;
    }

    function createObjParam(el, pName, pValue) {
      var p = createElement("param");
      p.setAttribute("name", pName);
      p.setAttribute("value", pValue);
      el.appendChild(p);
    }

    /* Cross-browser SWF removal
     - Especially needed to safely and completely remove a SWF in Internet Explorer
     */
    function removeSWF(id) {
      var obj = getElementById(id);
      if (obj && (obj.nodeName == "OBJECT" || obj.nodeName == "EMBED")) {
        if (ua.ie && ua.win) {
          if (obj.readyState == 4) {
            removeObjectInIE(id);
          }
          else {
            win.attachEvent("onload", function () {
              removeObjectInIE(id);
            });
          }
        }
        else {
          obj.parentNode.removeChild(obj);
        }
      }
    }

    function removeObjectInIE(id) {
      var obj = getElementById(id);
      if (obj) {
        for (var i in obj) {
          if (typeof obj[i] == "function") {
            obj[i] = null;
          }
        }
        obj.parentNode.removeChild(obj);
      }
    }

    /* Functions to optimize JavaScript compression
     */
    function getElementById(id) {
      var el = null;
      try {
        el = doc.getElementById(id);
      }
      catch (e) {
      }
      return el;
    }

    function createElement(el) {
      return doc.createElement(el);
    }

    /* Updated attachEvent function for Internet Explorer
     - Stores attachEvent information in an Array, so on unload the detachEvent functions can be called to avoid memory leaks
     */
    function addListener(target, eventType, fn) {
      target.attachEvent(eventType, fn);
      listenersArr[listenersArr.length] = [target, eventType, fn];
    }

    /* Flash Player and SWF content version matching
     */
    function hasPlayerVersion(rv) {
      var pv = ua.pv, v = rv.split(".");
      v[0] = parseInt(v[0], 10);
      v[1] = parseInt(v[1], 10) || 0; // supports short notation, e.g. "9" instead of "9.0.0"
      v[2] = parseInt(v[2], 10) || 0;
      return (pv[0] > v[0] || (pv[0] == v[0] && pv[1] > v[1]) || (pv[0] == v[0] && pv[1] == v[1] && pv[2] >= v[2])) ? true : false;
    }

    /* Cross-browser dynamic CSS creation
     - Based on Bobby van der Sluis' solution: http://www.bobbyvandersluis.com/articles/dynamicCSS.php
     */
    function createCSS(sel, decl) {
      if (ua.ie && ua.mac) {
        return;
      }
      var h = doc.getElementsByTagName("head")[0], s = createElement("style");
      s.setAttribute("type", "text/css");
      s.setAttribute("media", "screen");
      if (!(ua.ie && ua.win) && typeof doc.createTextNode != UNDEF) {
        s.appendChild(doc.createTextNode(sel + " {" + decl + "}"));
      }
      h.appendChild(s);
      if (ua.ie && ua.win && typeof doc.styleSheets != UNDEF && doc.styleSheets.length > 0) {
        var ls = doc.styleSheets[doc.styleSheets.length - 1];
        if (typeof ls.addRule == OBJECT) {
          ls.addRule(sel, decl);
        }
      }
    }

    function setVisibility(id, isVisible) {
      var v = isVisible ? "visible" : "hidden";
      if (isDomLoaded && getElementById(id)) {
        getElementById(id).style.visibility = v;
      }
      else {
        createCSS("#" + id, "visibility:" + v);
      }
    }

    /* Filter to avoid XSS attacks
     */
    function urlEncodeIfNecessary(s) {
      var regex = /[\\\"<>\.;]/;
      var hasBadChars = regex.exec(s) != null;
      return hasBadChars ? encodeURIComponent(s) : s;
    }

    /* Release memory to avoid memory leaks caused by closures, fix hanging audio/video threads and force open sockets/NetConnections to disconnect (Internet Explorer only)
     */
    var cleanup = function () {
      if (ua.ie && ua.win) {
        window.attachEvent("onunload", function () {
          // remove listeners to avoid memory leaks
          var ll = listenersArr.length;
          for (var i = 0; i < ll; i++) {
            listenersArr[i][0].detachEvent(listenersArr[i][1], listenersArr[i][2]);
          }
          // cleanup dynamically embedded objects to fix audio/video threads and force open sockets and NetConnections to disconnect
          var il = objIdArr.length;
          for (var j = 0; j < il; j++) {
            removeSWF(objIdArr[j]);
          }
          // cleanup library's main closures to avoid memory leaks
          for (var k in ua) {
            ua[k] = null;
          }
          ua = null;
          for (var l in swfobject) {
            swfobject[l] = null;
          }
          swfobject = null;
        });
      }
    }();


    return {
      /* Public API
       - Reference: http://code.google.com/p/swfobject/wiki/SWFObject_2_0_documentation
       */
      registerObject: function (objectIdStr, swfVersionStr, xiSwfUrlStr) {
        if (!ua.w3cdom || !objectIdStr || !swfVersionStr) {
          return;
        }
        var regObj = {};
        regObj.id = objectIdStr;
        regObj.swfVersion = swfVersionStr;
        regObj.expressInstall = xiSwfUrlStr ? xiSwfUrlStr : false;
        regObjArr[regObjArr.length] = regObj;
        setVisibility(objectIdStr, false);
      },

      getObjectById: function (objectIdStr) {
        var r = null;
        if (ua.w3cdom) {
          var o = getElementById(objectIdStr);
          if (o) {
            var n = o.getElementsByTagName(OBJECT)[0];
            if (!n || (n && typeof o.SetVariable != UNDEF)) {
              r = o;
            }
            else if (typeof n.SetVariable != UNDEF) {
              r = n;
            }
          }
        }
        return r;
      },

      embedSWF: function (swfUrlStr, replaceElemIdStr, widthStr, heightStr, swfVersionStr, xiSwfUrlStr, flashvarsObj, parObj, attObj) {
        if (!ua.w3cdom || !swfUrlStr || !replaceElemIdStr || !widthStr || !heightStr || !swfVersionStr) {
          return;
        }
        widthStr += ""; // Auto-convert to string
        heightStr += "";
        if (hasPlayerVersion(swfVersionStr)) {
          setVisibility(replaceElemIdStr, false);
          var att = {};
          if (attObj && typeof attObj === OBJECT) {
            for (var i in attObj) {
              if (attObj[i] != Object.prototype[i]) { // Filter out prototype additions from other potential libraries
                att[i] = attObj[i];
              }
            }
          }
          att.data = swfUrlStr;
          att.width = widthStr;
          att.height = heightStr;
          var par = {};
          if (parObj && typeof parObj === OBJECT) {
            for (var j in parObj) {
              if (parObj[j] != Object.prototype[j]) { // Filter out prototype additions from other potential libraries
                par[j] = parObj[j];
              }
            }
          }
          if (flashvarsObj && typeof flashvarsObj === OBJECT) {
            for (var k in flashvarsObj) {
              if (flashvarsObj[k] != Object.prototype[k]) { // Filter out prototype additions from other potential libraries
                if (typeof par.flashvars != UNDEF) {
                  par.flashvars += "&" + k + "=" + flashvarsObj[k];
                }
                else {
                  par.flashvars = k + "=" + flashvarsObj[k];
                }
              }
            }
          }
          addDomLoadEvent(function () {
            createSWF(att, par, replaceElemIdStr);
            if (att.id == replaceElemIdStr) {
              setVisibility(replaceElemIdStr, true);
            }
          });
        }
        else if (xiSwfUrlStr && !isExpressInstallActive && hasPlayerVersion("6.0.65") && (ua.win || ua.mac)) {
          isExpressInstallActive = true; // deferred execution
          setVisibility(replaceElemIdStr, false);
          addDomLoadEvent(function () {
            var regObj = {};
            regObj.id = regObj.altContentId = replaceElemIdStr;
            regObj.width = widthStr;
            regObj.height = heightStr;
            regObj.expressInstall = xiSwfUrlStr;
            showExpressInstall(regObj);
          });
        }
      },

      getFlashPlayerVersion: function () {
        return {major: ua.pv[0], minor: ua.pv[1], release: ua.pv[2]};
      },

      hasFlashPlayerVersion: hasPlayerVersion,

      createSWF: function (attObj, parObj, replaceElemIdStr) {
        if (ua.w3cdom) {
          return createSWF(attObj, parObj, replaceElemIdStr);
        }
        else {
          return undefined;
        }
      },

      removeSWF: function (objElemIdStr) {
        if (ua.w3cdom) {
          removeSWF(objElemIdStr);
        }
      },

      createCSS: function (sel, decl) {
        if (ua.w3cdom) {
          createCSS(sel, decl);
        }
      },

      addDomLoadEvent: addDomLoadEvent,

      addLoadEvent: addLoadEvent,

      getQueryParamValue: function (param) {
        var q = doc.location.search || doc.location.hash;
        if (param == null) {
          return urlEncodeIfNecessary(q);
        }
        if (q) {
          var pairs = q.substring(1).split("&");
          for (var i = 0; i < pairs.length; i++) {
            if (pairs[i].substring(0, pairs[i].indexOf("=")) == param) {
              return urlEncodeIfNecessary(pairs[i].substring((pairs[i].indexOf("=") + 1)));
            }
          }
        }
        return "";
      },

      // For internal usage only
      expressInstallCallback: function () {
        if (isExpressInstallActive && storedAltContent) {
          var obj = getElementById(EXPRESS_INSTALL_ID);
          if (obj) {
            obj.parentNode.replaceChild(storedAltContent, obj);
            if (storedAltContentId) {
              setVisibility(storedAltContentId, true);
              if (ua.ie && ua.win) {
                storedAltContent.style.display = "block";
              }
            }
            storedAltContent = null;
            storedAltContentId = null;
            isExpressInstallActive = false;
          }
        }
      }
    };
  }();
})(window);