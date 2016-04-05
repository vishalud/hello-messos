# OpenTable NodeJS Mesos Workshop

This is a step by step guide to writing a simple NodeJS HTTP application ready for deployment on OpenTable's Mesos Platform. We will be using Docker, Mesos and Singularity to build the app.

## You will need:
- docker (On Mac the easiest way to get this is to install the Docker Toolbox)
- node

## Step 1: Set up your git repo for success

    $ mkdir hello-mesos && cd hello-mesos
    $ git init
    $ npm init -y

Now add your .editorconfig, .npmrc, and .gitignore files as they are in this repo. You should also add a `README.md`. Your repo should now look like this...
    
    $ tree .
    .                
    ├── .editorconfig
    ├── .gitignore   
    ├── .npmrc       
    ├── README.md    
    └── package.json 

## Step 2: Hello, HAPI

Install hapi, the HTTP API library we will be using for this example.

    $ npm install --save hapi

The --save adds a dependency to your package.json, which we will commit with this step.

Now, let's write a very simple HTTP app. See the file `app.js`. To run it, do:

    $ node app.js
    Server running at: http://localhost:3000

Open another terminal window and do:

    $ curl http://localhost:3000
    Hello, HAPI.

OK, back in the original window, press `Ctrl+C` to send an interrupt (SIGINT) and kill the app.

## Step 3: Environment decides the host and port

Because Mesos controls both which host agent your app will run on, and which TCP port it needs to listen on, you need to respect two environment variables related to this: `TASK_HOST` and `PORT0`. In fact, you can request a number of ports from Mesos, and you will be provided with `PORT0`, `PORT1`, `PORT2`, etc.

So, add the following lines at the start of app.js:

```js
var TASK_HOST = process.env.TASK_HOST;
var PORT0 = process.env.PORT0;

// Exit immediately if either TASK_HOST or PORT0 are not provided.
if (!TASK_HOST) { console.log("TASK_HOST not set"); process.exit(3); }
if (!PORT0)     { console.log("PORT0 not set"); process.exit(3); }
```

And change the line

```js
server.connection({host: "localhost", port: 3000});`
```

to

```js
server.connection({host: TASK_HOST, port: PORT0})
```

Now, in order to start the app, you will need to provide values for each of these, e.g.

```shell
$ TASK_HOST=localhost PORT0=3000 node app.js
```

## Step 4: Dockerfile -> Docker image -> Docker container

Now we have a working application, let's add a `Dockerfile` which is a recipe for building a Docker image:

```dockerfile
FROM docker.otenv.com/ot-node-4.2.3:latest

MAINTAINER Your Name <username@opentable.com>

ENTRYPOINT ["/usr/local/bin/node", "app.js"]
```

Now, you can build a docker _image_ by issuing the `docker build` command. You use the `-t` option to "tag" your image, giving it a name you can refer to it by later.

```shell
$ docker build -t hello-mesos .
```

Assuming all built ok, you can now create a Docker _container_ (which is a running instance of an image) by issuing the `docker run` command:


```shell
$ docker run hello-mesos
```

If you have followed up to this point, that docker run command ought to fail, saying `TASK_HOST not set`. So, we can try passing in the environment variables using the special `docker run` `-e` option:

```shell
$ docker run -e TASK_HOST=localhost -e PORT0=3000 hello-mesos
```

Your task will now run, however, if you now try to `curl` to that address in another terminal window, you will get an error:

```shell
$ curl http://localhost:3000
curl: (7) Failed to connect to localhost port 3000: Connection refused
```

Furthermore when you try to `Ctrl+C` to exit your app, it will probably not respond, just printing `^C^C^C^C^C^C^C` etc. This is because something funky is going on since node 4 (not Node 5 as [this GitHub issue](https://github.com/nodejs/node/issues/4182) states).

So, in another pane, run `docker ps` to view your running containers, and identify the container ID (first column) of your failing container. Then kill it using:

```shell
docker kill <ContainerID>
```

In order to make `Ctrl+C` work again, you need to add explicit signal handlers that will cause your app to exit when it receives `SIGINT` (the signal sent by `Ctrl+C`). And whilst we're doing that, we will also add a handler for `SIGTERM` which is the signal Mesos uses to tell your app to stop when needed.

Open up your app.js and insert the following two lines at the start of the file:

```js
process.on("SIGINT", function() { console.log("Caught SIGINT"); process.exit(0); });
process.on("SIGTERM", function() { console.log("Caught SIGTERM"); process.exit(0); });
```

Since you edited the source code, you will need to rebuild your docker image using the same command as last time.

Now when you run your container with `docker run`, `Ctrl+C` will work as expected, however, we still need to deal with not being able to connect to our container.

### 4.5 Docker Networking
 This is where things get interesting. Docker, by default, uses "bridge" networking, where each container gets its own network stack that is bridged to the host's network stack. This means your container gets its own IP address, and its own loopback `127.0.0.1` and thus `localhost` means local to the container itself. This problem is resolved by telling the container to share its host's networking stack, and thus share the same IP address and `localhost`. This is done with the `--net=host` option:

```shell
$ docker run --net=host -e TASK_HOST=localhost -e PORT0=3000 hello-mesos
```

**However, if you are using Docker Machine, you have another problem.** That is because Docker Machine runs Docker inside a virtual machine (VM), with a different host name, IP address, and networking stack than your Mac. So now your container is using the same networking stack as that VM. It's one step closer, but still not accessible.

To fix this, we need to tell our app to listen on the IP address of the Docker Machine VM. You can find this by typing:

```shell
$ echo $DOCKER_HOST
tcp://192.168.99.100:2376
```

Now, whatever IP address you see there, you can use as your `TASK_HOST` e.g.:

```shell
$ docker run --net=host -e TASK_HOST=192.168.99.100 PORT0=3000 hello-mesos
```

Finally, running a `curl` in another window, you will be able to access your application:

```shell
$ curl http://192.168.99.100
Hello, HAPI.
```

You have conquered a few fiddly hurdles of the local Docker workflow, give yourself a pat on the back.

## Step 5: Push your docker image
Now we have a working image, let's distribute it so that we can eventually deploy it into one of our Mesos clusters.

In order to push a docker image to a remote registry, it needs to be tagged with that registry's address. At OpenTable we use `docker.otenv.com` as our primary registry (this is mirrored to the regions, more on that later).

```shell
$ docker tag hello-mesos docker.otenv.com/<username>/hello-mesos
```

Now if you run `docker images` you should see this image in the list. Push it to the registry by doing:

```shell
$ docker push docker.otenv.com/<username>/hello-mesos
```

## Step 6: Manually deploy using Singularity
As a learning exercise, we will now deploy this app manually using Singularity. You will notice that the deploy fails "OVERDUE". This is because you do not yet have a /health endpoint, so Singularity believes your app is unhealthy, and kills it.

## Step 7: Adding a /health endpoint
In order to get our deploy to stick, we need to add a `/health` endpoint to our app. This is a way of signalling to Singularity that the application has started successfully. A better name for it might be "startup-complete" but it's historically been called "health" so we'll stick with that for now.

Edit your app.js to add the following lines before your `server.start`:

```js
server.route({method: "GET", path: "/health", handler: function(request, reply) {
  reply("I've started up successfully!\n");
}});
```

Now if you re-build your app and try to re-deploy, it should start and keep running.

> NOTE: Because we are not adding version tags to our app, it always gets tagged with "latest" automatically by Docker. That's fine for local development, but can cause issues when deploying, since Docker will not re-pull your new "latest" if it already has an image tagged "latest". Therefore, you will find it beneficial to tag your app with an incrementing number each time you build, and make sure you specify that tag when you deploy, to ensure you get the latest version of your app in Mesos.

## Step 8: otpl-deploy-scripts
As we all know, deploying manually is a very bad idea, since it is subject to variability and is difficult to repeat the same way twice. In order to automate out deployments, we have [a tool called `otpl-deploy-scripts`](https://github.com/opentable/otpl-deploy-scripts) which can read configuration in your repo, and perform the Singularity deploy step automatically.

So, we will clone github.com/opentable/otpl-deploy-scripts and add its `bin` directory to our path to test our deployment configuration locally, and later add a TeamCity build to run the deploy for us.

`otpl-deploy-scripts` uses a subset of the Singularity API to create requests (which are buckets into which deployments of an app are made) and the deployments themselves. You can view the API docs by going to a Singularity instance in your browser and clicking the link at the top of the page.

First, let's create our `request` object to deploy to our `qa-sf` cluster.

```shell
$ mkdir -p config/pp-sf
$ touch config/pp-sf/singularity-request.json
$ touch config/pp-sf/singularity.json
$ echo username/hello-mesos > docker-repo

# ... edit the first two files

# singularity-request.json is a partial SingularityRequest object
$ cat config/pp-sf/singularity-request.json
{
  "id": "hello-mesos-<username>",
  "owners": ["<username>@opentable.com"],
  "daemon": true,
  "rackSensitive": false,
  "loadBalanced": false,
  "instances": 2
}

# singularity.json is a partial SingularityDeploy object
$ cat config/pp-sf/singularity.json
{
  "requestId": "hello-mesos-<username>",
  "resources": {
    "cpus": 0.01,
    "memoryMb": 32,
    "numPorts": 1
  }
}
```

Once you've finished, you can now try to deploy. Make sure you're in the root of your project, and enter:

```shell
$ otpl-deploy pp-sf <tag>
```

Where `<tag>` is either `latest` if you're gambling with which version gets deployed, or whatever you tagged your desired release image as.

## Step 9: Service Discovery

Now we have the app deployed, but finding it requires using the Singularity UI to locate the host and port. So, let's add a service discovery library to handle announcing our app to the rest of the datacentre so it can be found.

> NOTE: You must ensure that you never announce a locally-running service to any discovery server. Whilst the discovery server itself will simply ignore any unreachable announcements it receives, it is still bad practice to make them in the first place.

First, let's install the `hapi-service-discovery` library and save that fact in our package.json:

```shell
npm install --save hapi-service-discovery
```

So, open up your app.js, and change the server.start call to the following: add the following block to configure your service discovery client, somewhere before your `server.start`:

```js
// Default to development mode if OT_ENV is not set.
var NODE_ENV = process.env.OT_ENV || "development";

var discoveryHost = "discovery-pp-sf.otenv.com";
var homeRegionName = "pp-sf";
var serviceUri = "http://" + TASK_HOST + ":" + PORT0;
var serviceType = "hello-mesos-vuderani";

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

```

So, build, push, and then deploy your docker image. It should now be announcing, and you can see the announcements at http://discovery-pp-sf.otenv.com. Obviously, hard-coding the `discoveryHost` as we did above is not a good idea in general, as it makes your image non-portable.
