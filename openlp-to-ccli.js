var sqlite3 = require('sqlite3');
var xml2js = require('xml2js');
var async = require('async');
var fs = require('fs');
var _ = require('lodash');
var slugify = require('underscore.string/slugify');

var QUERY = 'select * from songs AS s inner join authors_songs AS asi,authors AS ai on asi.song_id=s.id and asi.author_id=ai.id;';
var PATH = 'songs.sqlite';
var TEXT_FILE_PATH = 'out/';

var db = new sqlite3.Database(PATH);
//db.all(QUERY)

var shortToLong = function (item) {
    var out = '';
    switch (_.first(item).toLowerCase()) {
        case 'v':
            out = 'Verse';
            break;
        case 'c':
            out = 'Chorus';
            break;
        case 'b':
            out = 'Bridge';
            break;
        case 'e':
            out = 'Ending';
            break;
        case 'p':
            out = 'Prechorus';
            break;
    }
    if (out) {
        out += ' ' + (item.substr(1)||1);
    } else {
        out = item;
    }

    return out;
};

var playOrder = function (verse_order) {
    var order = _.compact(verse_order.split(/[\s,]+/));
    try {
        return _.map(order, shortToLong).join(', ');
    } catch (e) {
        console.warn(order);
        throw e;
    }
};

var generateVerses = function (lyrics) {
    return _.chain(lyrics.song.lyrics[0].verse)
        .map(function (verse) {
            //console.log(JSON.stringify(verse, null, 2))
            try {
                var id = shortToLong(verse.$.type + verse.$.label);
            } catch (e) {
                console.warn(verse);
                throw e;
            }
            return {
                id: id,
                verse: verse._
            };
        })
        .groupBy('id')
        .map(function (val, id) {
            return id + '\n' + _.pluck(val, 'verse').join('\n');
        })
        .reduce(function (memo, item) {
            memo += item + '\n\n';
            return memo;
        }, '')
        //.tap(function (x) { console.log(x)})
        .value();
};

return async.auto({
    rows: function (next) {
        //_.partial(db.all, db, QUERY),
        return db.all(QUERY, next);
    },
    parseLyrics: ['rows', function (next, args) {
        async.map(args.rows, function (row, nextRow) {
            xml2js.parseString(row.lyrics, function (err, obj) {
                row.lyrics = obj;
                return nextRow(err, row);
            });
        }, next);
    }],
    toText: ['parseLyrics', function (next, args) {
        var out = _.chain(args.parseLyrics)
            .groupBy('song_id')
            .map(function (songs) {
                var song = _.first(songs);
                var authors = _.pluck(songs, 'display_name').join(', ');
                var title = song.title + (song.alternate_title ? ' (' + song.alternate_title + ')' : '');

                var out = [
                    'Title: ' + title,
                    'Author: ' + authors,
                    'Copyright: ' + song.copyright,
                    'CCLI: ' + song.ccli_number,
                    'Song ID: ' + song.song_id,
                    'Notes: ' + song.comments,
                    'PlayOrder: ' + playOrder(song.verse_order),
                    '',
                    generateVerses(song.lyrics)
                ];
                return {
                    filename: slugify(title) + '.txt',
                    text: out.join('\n')
                };
            })
            .value();

        return next(null, out);
    }],
    save: ['toText', function (next, args) {
        return async.each(args.toText, function(file, nextFile) {
            return fs.writeFile(TEXT_FILE_PATH + file.filename, file.text, nextFile);
        }, next);
    }]
}, function (err, data) {
    db.close();
    if (err) return console.warn('Error', err);

    console.log('Saved ' + _.size(data.toText) + ' songs to ' + TEXT_FILE_PATH);
});
