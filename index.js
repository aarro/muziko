var SpotifyWebApi = require('spotify-web-api-node');
var TelegramBot = require('node-telegram-bot-api');
var _ = require('lodash');
var express = require('express');
var TinyURL = require('tinyurl');
var uuid = require('uuid/v1');
var app = express();

var appSpotifyCallback = '/spotifyCallback';
var spotifyScopes = ['playlist-modify-public', 'playlist-modify-private', 'playlist-read-private'];
var spotifyTokenMap = [];
var spotifyStateMap = [];

var spotifyApi = new SpotifyWebApi({
  clientId: process.env.spotify_clientId,
  clientSecret: process.env.spotify_clientSecret,
  redirectUri: process.env.baseUrl + appSpotifyCallback
});

app.set('port', (process.env.PORT));

app.get('/', function (request, response) {
  response.send('<p>Online!</p>');
});

app.get(appSpotifyCallback, function (req, res) {
  var error = '';
  var u = _.find(spotifyStateMap, { 'u': req.query.state });
  if (req.query.code && u) {
    spotifyApi.resetAccessToken();
    spotifyApi.resetRefreshToken();

    spotifyApi.authorizationCodeGrant(req.query.code)
      .then(function (data) {
        var token = data.body;
        spotifyApi.setAccessToken(token.access_token);
        spotifyApi.getMe()
          .then(function (data) {
            addSpotifyUser(token, data.body, u.id);
            res.status(200).send('<script>window.close();</script>;');
          }, function (err) {
            res.status(404).send(err);
          });
      }, function (err) {
        res.status(404).send(err);
      });
  } else {
    res.status(404).send('User denied access');
  }
});

app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'));
});

function addSpotifyUser(token, user, state) {
  var o = _.find(spotifyTokenMap, { 'chat': state });
  if (!o) {
    o = { 'chat': state, 'users': [] };
    spotifyTokenMap.push(o);
  }
  var u = _.find(o.users, { 'id': user.id });
  if (!u) {
    u = { 'id': user.id };
    o.users.push(u);
  }
  u.access_token = token.access_token;
  u.refresh_token = token.refresh_token;
}

function searchForUserPlaylist(userId, playlistName) {
  var options = { 'limit': 50, 'offset': 0 };

  function search(userId, playlistName, options) {
    return spotifyApi.getUserPlaylists(userId, options)
      .then(function (d) {
        var m = _.find(d.body.items, { 'name': playlistName });
        if (m)
          return new Promise(function (res) { res(m); });
        else if (d.body.next) {
          options.offset = options.offset + options.limit;
          return search(userId, playlistName, options);
        }
        else
          return new Promise(function (res) { res(undefined); });
      });
  }

  return search(userId, playlistName, options);
}

var telegramToken = process.env.telegram_token;
var bot = new TelegramBot(telegramToken, { polling: true });

//**msg.from.id is always the user, even in a group
//**msg.chat.id is the user in a direct chat but the group id in a group chat

//get the current user, make sure they're auth'd, and if so get their currently play track and share a link. 
bot.onText(/\/share/, function (msg, match) {

});

//tracks yo! Need to make this ignore tracks posted by the bot
bot.onText(/https:\/\/open.spotify.com\/track\/(.+)/, function (msg, match) {
  var tid = match[1];
  var id = msg.chat.id;
  var name = msg.chat.title;
  var token = _.find(spotifyTokenMap, { 'chat': id });

  if (token) {
    _.forEach(token.users, function (v) {
      spotifyApi.resetAccessToken();
      spotifyApi.resetRefreshToken();
      spotifyApi.setAccessToken(v.access_token);
      spotifyApi.setRefreshToken(v.refresh_token);

      var promise = new Promise(function (res, ref) {
        if (v.playlistId)
          res(v.playlistId);
        else {
          searchForUserPlaylist(v.id, name)
            .then(function (p) {
              if (p) {
                v.playlistId = p.id;
                res(v.playlistId);
              } else {
                spotifyApi.createPlaylist(v.id, name, { 'public': false })
                  .then(function (d) {
                    v.playlistId = d.body.id;
                    res(v.playlistId);
                  }, function (err) {
                    console.log('Something went wrong!', err);
                    rej(err);
                  });
              }
            });
        }
      });

      promise
        .then(function (pid) {
          if (v.playlistId) {
            spotifyApi.addTracksToPlaylist(v.id, v.playlistId, ["spotify:track:" + tid])
              .then(function (data) {
                console.log('Added tracks to playlist!');
              }, function (err) {
                console.log('Something went wrong!', err);
              });
          }
        });
    });
  }
  else {
    bot.sendMessage(id, 'I\'m sorry but no one in this chat seems to be registered');
  }
});

//authenticate the group with spotify.
bot.onText(/\/auth/, function (msg, match) {
  var u = uuid();
  var a = spotifyApi.createAuthorizeURL(spotifyScopes, u);// + '&show_dialog=true';
  spotifyStateMap.push({ 'u': u, 'id': msg.chat.id });
  TinyURL.shorten(a, function (res) {
    bot.sendMessage(msg.chat.id, "Please visit the following link to associate your spotify account. " + res);
  });
});