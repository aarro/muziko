# muziko
A telegram bot to add song links to spotify playlists. 

### Functional
- Authenticate users in the group with their spotify account using /auth command.
- The bot is listening for spotify track links. Once one is linked by a group member, any authenticated members will have the track added to a spotify playlist named after the group.

### Immediate Future
- The auth only lasts as long as the initial grant. Need to implement token refreshing.
- Persistence needed so that when the bot recycles or is updated auth information isn't lost.

### Long Term
- /share command to have the bot link your currently playing track.
- Ability for bot to track artists or public playlists
