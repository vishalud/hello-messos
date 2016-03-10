FROM docker.otenv.com/ot-node-4.2.3:latest

MAINTAINER Sam Salisbury <ssalisbury@opentable.com>

ENTRYPOINT ["/usr/local/bin/node", "app.js"]
