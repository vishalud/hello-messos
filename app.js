process.on("SIGINT", function() { console.log("Caught SIGINT"); process.exit(0); });
process.on("SIGTERM", function() { console.log("Caught SIGTERM"); process.exit(0); });

var TASK_HOST = process.env.TASK_HOST;
var PORT0 = process.env.PORT0;

// Exit immediately if either TASK_HOST or PORT0 are not provided.
if (!TASK_HOST) { console.log("TASK_HOST not set"); process.exit(3); }
if (!PORT0)     { console.log("PORT0 not set"); process.exit(3); }

var server = new (require('hapi').Server)();
server.connection({host: TASK_HOST, port: PORT0})

server.route({method: "GET", path: "/", handler: function(request, reply) {
  reply("Hello, HAPI.\n");
}});

server.route({method: "GET", path: "/health", handler: function(request, reply) {
  reply("I've started up successfully!\n");
}});

// Default to development mode if OT_ENV is not set.
var NODE_ENV = process.env.OT_ENV || "development";

var discoveryHost = "discovery-pp-sf.otenv.com";
var homeRegionName = "pp-sf";
var serviceUri = "http://" + TASK_HOST + ":" + PORT0;
var serviceType = "hello-mesos-ssalisbury";

server.register([{
  register: require("hapi-service-discovery"),
    options: {
      host: discoveryHost,
      homeRegionName: homeRegionName,
	    serviceType: serviceType,
	    serviceUri: serviceUri,
	    onError: function(err) {
		    console.log("Discovery error: " + err)
	    }
    }
  }],
  server.start(function(err) {
    if (err) { throw err; }
    console.log("Server running at:", server.info.uri);

    // Only announce if we are not in development mode.
    if(NODE_ENV !== "development") {
    	server.plugins["hapi-service-discovery"].announce(function () {
        	console.log("ANNOUNCED " + serviceType + "@" + serviceUri + " to " + discoveryHost);
    	});
    } else {
      console.log("Not announcing, as running in development mode.");
    }
  })
);
