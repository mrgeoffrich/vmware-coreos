var gulp = require('gulp');
var ts = require("gulp-typescript");
var request = require('request');
var gunzip = require('gulp-gunzip');
var untar = require('gulp-untar');
var source = require('vinyl-source-stream');
var clean = require('gulp-clean');

var tsProject = ts.createProject('tsconfig.json');

gulp.task('prepare-download', function () {
  return request('https://download3.vmware.com/software/vmw-tools/vsphere-sdk-for-javascript/vsphere-1.1.0.tgz')
  .pipe(source('vsphere-1.1.0.tgz'))
  .pipe(gunzip())
  .pipe(untar())
  .pipe(gulp.dest('vmware'))
});

gulp.task('prepare', ['prepare-download'], function () {
  return gulp.src('vmware/package/dist/vsphere.js')
    .pipe(gulp.dest('vmware'));
});

gulp.task('build', ['prepare'], function () {
    return tsProject.src()
        .pipe(tsProject())
        .js.pipe(gulp.dest('build'));
});

gulp.task('clean', function () {
  return gulp.src(['build', 'vmware'], {read: false})
    .pipe(clean());
});

gulp.task('default', ['build']);