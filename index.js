var SpotifyWebApi = require('spotify-web-api-node');
var TelegramBot = require('node-telegram-bot-api');
var _ = require('lodash');
var express = require('express');
var TinyURL = require('tinyurl');
var uuid = require('uuid/v1');
var http = require("http");
var https = require("https");
var extend = require('util')._extend;
var app = express();

var bot = new TelegramBot(process.env.telegram_token, { polling: true });
var spotifyScopes = ['playlist-modify-public', 'playlist-modify-private', 'playlist-read-private'];
var spotifyTokenMap = [];
var spotifyStateMap = [];
var spotifyCreds = {
  clientId: process.env.spotify_clientId,
  clientSecret: process.env.spotify_clientSecret,
  redirectUri: process.env.baseUrl + '/' + process.env.spotify_callback
};

app.set('port', (process.env.PORT));

app.get('/', function (req, res) {
  res.send('<p>Online!</p>');
});

app.get('/' + process.env.spotify_callback, function (req, res) {
  if (req && req.query && req.query.state) {
    var u = _.find(spotifyStateMap, { 'u': req.query.state });

    if (req.query.code && u) {
      var sa = new SpotifyWebApi(extend({}, spotifyCreds));
      sa.authorizationCodeGrant(req.query.code)
        .then(function (data) {
          var token = data.body;
          sa.setAccessToken(token.access_token);
          sa.getMe()
            .then(function (data) {
              var m = addSpotifyUserToMap(token, data.body, u.id);
              console.log('Successfully added user=' + data.body.id + ' to spotifyTokenMap for chat.id' + m.chat + '. This spotifyTokenMap entry now has ' + m.users.length + ' users');
              res.status(200).send('<script>window.close();</script>;');
            }, function (err) {
              console.log('Error getting user from Spotify!', err);
              res.status(404).send(err);
            });
        }, function (err) {
          console.log('Error getting access token from Spotify!', err);
          res.status(404).send(err);
        });
    } else {
      console.log('User denied Spotify access or expired link');
      res.status(404).send('User denied access');
    }
  }
});

app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'));
});

// every 10 minutes hit the site to keep heroku alive
setInterval(function () {
  if (process.env.baseUrl.startsWith("http://"))
    http.get(process.env.baseUrl);
  else if (process.env.baseUrl.startsWith("https://"))
    https.get(process.env.baseUrl);
  else { }
}, 600000);

function addSpotifyUserToMap(token, user, state) {
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
  setUserTokenMapData(u, token);
  return o;
}

//call after getting a new SpotifyWebApi instance to set the token info for the cached user
function setAndRefreshToken(sa, chatId, userId) {
  var c = _.find(spotifyTokenMap, { 'chat': chatId });
  if (c) {
    var u = _.find(c.users, { 'id': userId });
    if (u) {
      setSpotifyApiTokens(sa, u);
      var n = Date.now();
      //give it a couple minutes to make sure the token hasn't expired
      if (n > (u.expires - 120000)) {
        return sa.refreshAccessToken()
          .then(function (d) {
            console.log('user=' + userId + ' access token refreshed!');
            setUserTokenMapData(u, d.body);
            setSpotifyApiTokens(sa, u);
            return Promise.resolve(u);
          }, function (err) {
            return Promise.reject('user=' + userId + ' failed to refresh token! Refresh token is=' + u.refresh_token, err);
          });
      } else {
        console.log('user=' + userId + ' current token is ok');
        return Promise.resolve(u);
      }
    }
  }
  return Promise.reject('user=' + userId + ' not found in chat=' + chatId);
}

function setUserTokenMapData(user, token) {
  console.log('...userId=' + user.id + ' starting setting token data...');
  for (var p in token) {
    var v = token[p];
    console.log(p, v);
  }
  console.log('...userId=' + user.id + ' finished setting token data...');

  user.access_token = token.access_token;
  if (token.refresh_token)
    user.refresh_token = token.refresh_token;
  user.expires = Date.now() + (1000 * token.expires_in);
}

function setSpotifyApiTokens(sa, user) {
  sa.resetAccessToken();
  sa.resetRefreshToken();
  sa.setAccessToken(user.access_token);
  sa.setRefreshToken(user.refresh_token);
}

//find a playlist by name for a user
function searchForUserPlaylist(sa, userId, playlistName) {
  var options = { 'limit': 50, 'offset': 0 };

  function search(saa, userId, playlistName, options) {
    return saa.getUserPlaylists(userId, options)
      .then(function (d) {
        var m = _.find(d.body.items, { 'name': playlistName });
        if (m) {
          console.log('user=' + userId + ' found existing playlist=' + m.id);
          return Promise.resolve(m);
        } else if (d.body.next) {
          options.offset = options.offset + options.limit;
          return search(saa, userId, playlistName, options);
        }
        else {
          console.log('Failed to find existing playlist for user=' + userId);
          return Promise.resolve(undefined);
        }
      }, function (err) {
        return Promise.reject(err);
      });
  }

  return search(sa, userId, playlistName, options);
}

//find a playlist by name for a user. If it doesn't exist, create it.
function getPlaylistForChatAndUser(sa, user, name) {
  if (user.playlistId) {
    console.log('chat.title=' + name + ' user=' + user.id + ' already had playlist=' + user.playlistId + ' cached.');
    return Promise.resolve(user.playlistId);
  } else {
    return searchForUserPlaylist(sa, user.id, name)
      .then(function (p) {
        if (p) {
          user.playlistId = p.id;
          return Promise.resolve(user.playlistId);
        } else {
          console.log('Creating a playlist for user=' + user.id);
          return sa.createPlaylist(user.id, name, { 'public': false })
            .then(function (d) {
              user.playlistId = d.body.id;
              console.log('chat.title=' + name + ' user=' + user.id + ' created playlist=' + user.playlistId);
              return Promise.resolve(user.playlistId);
            }, function (err) {
              console.log('chat.title=' + name + ' Failed to create playlist for user=' + user.id, err);
              return Promise.reject(err);
            });
        }
      }, function (err) {
        return Promise.reject(err);
      });
  }
}

//add a track to user's playlist
function addTrackToPlaylist(chatId, userId, trackId, chatName) {
  var sa = new SpotifyWebApi(extend({}, spotifyCreds));
  return setAndRefreshToken(sa, chatId, userId)
    .then(function (u) {
      return getPlaylistForChatAndUser(sa, u, chatName)
        .then(function (pid) {
          return sa.addTracksToPlaylist(userId, pid, ["spotify:track:" + trackId], { 'position': 0 })
            .then(function (d) {
              console.log('chat.title=' + chatName + ' user=' + userId + ' successfully added track=' + trackId + ' to playlist=' + pid);
              return Promise.resolve(d);
            }, function (err) {
              console.log('chat.title=' + chatName + ' user=' + userId + ' FAILED to add track=' + trackId + ' to playlist=' + pid, err);
              return Promise.reject(err);
            });
        }, function (err) {
          console.log('chat.title=' + chatName + ' user=' + userId + ' playlist was unknown!', err);
          return Promise.reject(err);
        });
    }, function (err) {
      console.log('chat.title=' + chatName + ' user=' + userId + ' failed to refresh token!', err);
      return Promise.reject(err);
    });
}

//**msg.from.id is always the user, even in a group
//**msg.chat.id is the user in a direct chat but the group id in a group chat

//get the current user, make sure they're auth'd, and if so get their currently play track and share a link. 
// bot.onText(/\/share/, function (msg, match) {

// });

//tracks yo! Need to make this ignore tracks posted by the bot
bot.onText(/https:\/\/open.spotify.com\/track\/(\S+)/, function (msg, match) {
  // see if there's a way to tell if a message is delayed (like sent while the bot is down) and ignore it
  var tid = match[1];
  var id = msg.chat.id;
  var name = msg.chat.title;
  var token = _.find(spotifyTokenMap, { 'chat': id });
  console.log('Found regex match for spotify track. track=' + tid + ' | chat.id=' + id + ' | chat.title=' + name);

  if (token) {
    console.log('chat.title=' + name + ' had ' + token.users.length + ' users registered for the track=' + tid);
    var promises = [];
    _.forEach(token.users, function (v) { promises.push(addTrackToPlaylist(id, v.id, tid, name)); });
    Promise.all(promises)
      .then(function (r) {
        if (r && r.length > 0)
          console.log(r.length + ' items succeeded!');
      }, function (err) {
        console.log('Promise.all failed', err);
      });
  }
  else {
    console.log('chat.title=' + name + ' had no users registered for the track=' + tid);
    //bot.sendMessage(id, 'I\'m sorry but no one in this chat seems to be registered');
  }
});

//authenticate the group with spotify.
bot.onText(/\/auth/, function (msg) {
  console.log('chat.title=' + msg.chat.title + ' requesting auth!');
  var u = uuid();
  var sa = new SpotifyWebApi(extend({}, spotifyCreds));
  var a = sa.createAuthorizeURL(spotifyScopes, u);// + '&show_dialog=true';
  spotifyStateMap.push({ 'u': u, 'id': msg.chat.id });
  TinyURL.shorten(a, function (res) {
    bot.sendMessage(msg.chat.id, "Please visit the following link to associate your spotify account. " + res);
  });
});