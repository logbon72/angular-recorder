'use strict';

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