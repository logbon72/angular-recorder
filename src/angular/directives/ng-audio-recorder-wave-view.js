'use strict';

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