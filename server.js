var express = require('express');
var app = express();
var fs = require('fs');
const readline = require('readline');
const open = require('open');
const uuid = require('uuid');
var rimraf = require("rimraf");
const multer  = require("multer");
const https = require('https');
const http = require('http');
//const PNG = require('pngjs').PNG;
const extract = require('png-chunks-extract');
const encode = require('png-chunks-encode');
const PNGtext = require('png-chunk-text');
const ExifReader = require('exifreader');
const url = require('url');
function isUrl(str) {
    try {
        new URL(str);
        return true;
    } catch (err) {
        return false;
    }
}
const sharp = require('sharp');
sharp.cache(false);
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const ipaddr = require('ipaddr.js');
const json5 = require('json5');
var sanitize_filename = require("sanitize-filename");
const { TextEncoder, TextDecoder } = require('util');
const utf8Encode = new TextEncoder();
const utf8Decode = new TextDecoder('utf-8', { ignoreBOM: true });
const config = require(path.join(process.cwd(), './config.conf'));
const server_port = config.port;
const whitelist = config.whitelist;
const whitelistMode = config.whitelistMode;
let listenIp = null;
if (config.listenIp) {
    // If an advanced user has set the listen IP we use it explicitly
    listenIp = config.listenIp;    
} else if (!whitelistMode || whitelist.length > 1) {
    // If whitelist mode is disabled OR there are multiple IPs in the whitelist
    // we listen on all interfaces.
    listenIp = '0.0.0.0';
} else {
    // Otherwise we listen on the loopback address only
    listenIp = '127.0.0.1';
}
if (!whitelistMode && ipaddr.parse(listenIp).range() !== 'loopback') {
    console.warn(
`WARNING: You have configured TavernAI to listen on an IP address that 
         is not a loopback address ('${listenIp}'), and you have not enabled 
         white list mode. This means that your TavernAI server will be 
         accessible from other computers on your network. If you do not want 
         this, please change the listenIp setting in your config.conf file or
         enable and configure white list mode.`
    );
}
const autorun = config.autorun;
const characterFormat = config.characterFormat;
const charaCloudMode = config.charaCloudMode;
const charaCloudServer = config.charaCloudServer;
const connectionTimeoutMS = config.connectionTimeoutMS;
const csrf_token = config.csrf_token;
global.BETA_KEY;
var Client = require('node-rest-client').Client;
var client = new Client();
var api_server = "http://127.0.0.1:5000/api";//"http://127.0.0.1:5000";
const api_novelai = "https://api.novelai.net";
const api_openai = "https://api.openai.com/v1";
const api_horde = "https://stablehorde.net/api";
const api_ollama = "http://127.0.0.1:11434"; // Default Ollama API URL
var hordeActive = false;
var hordeQueue;
var hordeData = {};
var hordeError = null;
var hordeTicker = 0;
var response_get_story;
var response_generate;
var response_generate_novel;
var response_generate_openai;
var response_generate_claude;
var request_promt;
var response_promt;
var response_characloud_loadcard;
var characters = {};
var character_i = 0;
var response_create;
var response_edit;
var response_dw_bg;
var response_getstatus;
var response_getstatus_novel;
var response_getstatus_openai;
var response_getstatus_claude;
var response_getstatus_ollama;
var response_getlastversion;
var api_key_novel;
var api_key_openai;
var api_key_claude;
var api_url_openai;
var model_ollama; // Variable to store Ollama model name
var is_colab = false;
var charactersPath = 'public/characters/';
var worldPath = 'public/worlds/';
var chatsPath = 'public/chats/';
var UserAvatarsPath = 'public/User Avatars/';
var roomsPath = 'public/rooms/';
// if (is_colab && process.env.googledrive == 2){
    // charactersPath = '/content/drive/MyDrive/TavernAI/characters/';
    // chatsPath = '/content/drive/MyDrive/TavernAI/chats/';
    // UserAvatarsPath = '/content/drive/MyDrive/TavernAI/User Avatars/';
// }
const jsonParser = express.json({limit: '100mb'});
const urlencodedParser = express.urlencoded({extended: true, limit: '100mb'});
// CSRF Protection //
const doubleCsrf = require('csrf-csrf').doubleCsrf;
const CSRF_SECRET = crypto.randomBytes(8).toString('hex');
const COOKIES_SECRET = crypto.randomBytes(8).toString('hex');
const { invalidCsrfTokenError, generateToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => CSRF_SECRET,
    cookieName: "X-CSRF-Token",
    cookieOptions: {
        httpOnly: true,
        sameSite: "strict",
        secure: false
    },
    size: 64,
    getTokenFromRequest: (req) => req.headers["x-csrf-token"]
});
app.get("/csrf-token", (req, res) => {
    res.json({
        "token": generateToken(res)
    });
});
app.get("/timeout", (req, res) => {
    res.json({
        "timeout": connectionTimeoutMS
    });
});
if (csrf_token) {
    app.use(cookieParser(COOKIES_SECRET));
    app.use(doubleCsrfProtection);
}
// CORS Settings //
const cors = require('cors');
const CORS = cors({
    origin: 'null',
    methods: ['OPTIONS']
});
if (csrf_token) {
    app.use(CORS);
}
app.use(function (req, res, next) { //Security
    let clientIp = req.connection.remoteAddress;
    let ip = ipaddr.parse(clientIp);
    //Check if the IP address is IPv4-mapped IPv6 address
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) {
      const ipv4 = ip.toIPv4Address().toString();
      clientIp = ipv4;
    } else {
      clientIp = ip;
      clientIp = clientIp.toString();
    }
    //clientIp = req.connection.remoteAddress.split(':').pop();
    if (whitelistMode === true && !whitelist.includes(clientIp)) {
        console.log('Forbidden: Connection attempt from '+ clientIp+'. If you are attempting to connect, please add your IP address in whitelist or disable whitelist mode in config.conf in root of TavernAI folder.\n');
        return res.status(403).send('<b>Forbidden</b>: Connection attempt from <b>'+ clientIp+'</b>. If you are attempting to connect, please add your IP address in whitelist or disable whitelist mode in config.conf in root of TavernAI folder.');
    }
    next();
});
app.use((req, res, next) => {
    if (req.url.startsWith('/characters/') && is_colab && process.env.googledrive == 2) {
        let requestUrl = url.parse(req.url);
        const filePath = path.join(charactersPath, decodeURIComponent(requestUrl.pathname.substr('/characters'.length)));
        fs.access(filePath, fs.constants.R_OK, (err) => {
            if (!err) {
                res.sendFile(filePath);
            } else {
                res.send('Character not found: ' + filePath);
                //next();
            }
        });
    } else {
        next();
    }
});
app.use((req, res, next) => {
    if (req.url.startsWith('/User%20Avatars/') && is_colab && process.env.googledrive == 2) {
        let requestUrl = url.parse(req.url);
        const filePath = path.join(UserAvatarsPath, decodeURIComponent(requestUrl.pathname.substr('/User%20Avatars'.length)));
        fs.access(filePath, fs.constants.R_OK, (err) => {
            if (!err) {
                res.sendFile(filePath);
            } else {
                res.send('Avatar not found: ' + filePath);
                //next();
            }
        });
    } else {
        next();
    }
});
app.use(express.static(__dirname + "/public", { refresh: true }));
app.use('/backgrounds', (req, res) => {
  const filePath = decodeURIComponent(path.join(process.cwd(), 'public/backgrounds', req.url.replace(/%20/g, ' ')));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.status(404).send('File not found');
      return;
    }
    //res.contentType('image/jpeg');
    res.send(data);
  });
});
app.use('/characters', (req, res) => {
    let filePath = decodeURIComponent(path.join(process.cwd(), charactersPath, req.url.replace(/%20/g, ' ')));
    filePath = filePath.split('?v=');
    filePath = filePath[0];
    fs.readFile(filePath, (err, data) => {
    if (err) {
        res.status(404).send('File not found');
        return;
    }
    //res.contentType('image/jpeg');
    res.send(data);
  });
});
app.use('/cardeditor', (req, res) => {
    const requestUrl = url.parse(req.url);
    const filePath = decodeURIComponent(path.join(process.cwd(), 'public/cardeditor', requestUrl.pathname.replace(/%20/g, ' ')));
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.status(404).send('File not found');
            return;
        }
        //res.contentType('image/jpeg');
        res.send(data);
    });
});
app.use('/User%20Avatars', (req, res) => {
    const requestUrl = url.parse(req.url);
    const filePath = decodeURIComponent(path.join(process.cwd(), UserAvatarsPath, requestUrl.pathname.replace(/%20/g, ' ')));
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.status(404).send('File not found ');
            return;
        }
        //res.contentType('image/jpeg');
        res.send(data);
    });
});
app.use(multer({dest:"uploads"}).single("avatar"));
app.get("/", function(request, response){
    response.sendFile(__dirname + "/public/index.html"); 
});
app.get("/notes/*", function(request, response){
    response.sendFile(__dirname + "/public"+request.url+".html"); 
});
app.post("/getlastversion", jsonParser, function(request, response_getlastversion = response){
    if(!request.body) return response_getlastversion.sendStatus(400);
    const repo = 'TavernAI/TavernAI';
    let req;
    req = https.request({
        hostname: 'github.com',
        path: `/${repo}/releases/latest`,
        method: 'HEAD'
    }, (res) => {
        if(res.statusCode === 302) {
            const glocation = res.headers.location;
            const versionStartIndex = glocation.lastIndexOf('@')+1;
            const version = glocation.substring(versionStartIndex);
            //console.log(version);
            response_getlastversion.send({version: version});
        }else{
            response_getlastversion.send({version: 'error'});
        }
    });
    req.on('error', (error) => {
        console.error(error);
        response_getlastversion.send({version: 'error'});
    });
    req.end();
});
//**************Kobold api
app.post("/generate", jsonParser, function(request, response_generate = response){
    if(!request.body) return response_generate.sendStatus(400);
    //console.log(request.body.prompt);
    //const dataJson = json5.parse(request.body);
    request_promt = request.body.prompt;
    //console.log(request.body);
    var this_settings = { prompt: request_promt,
                        use_story:false,
                        use_memory:false,
                        use_authors_note:false,
                        use_world_info:false,
                        max_context_length: request.body.max_context_length
                        //temperature: request.body.temperature,
                        //max_length: request.body.max_length
                        };
    if(request.body.singleline) {
        this_settings.singleline = true
    }
    if(request.body.gui_settings == false){
        var sampler_order = [request.body.s1,request.body.s2,request.body.s3,request.body.s4,request.body.s5,request.body.s6,request.body.s7];
        this_settings = { prompt: request_promt,
                        use_story:false,
                        use_memory:false,
                        use_authors_note:false,
                        use_world_info:false,
                        max_context_length: request.body.max_context_length,
                        max_length: request.body.max_length,
                        rep_pen: request.body.rep_pen,
                        rep_pen_range: request.body.rep_pen_range,
                        rep_pen_slope: request.body.rep_pen_slope,
                        temperature: request.body.temperature,
                        tfs: request.body.tfs,
                        top_a: request.body.top_a,
                        top_k: request.body.top_k,
                        top_p: request.body.top_p,
                        typical: request.body.typical,
                        sampler_order: sampler_order
                        };
        if(request.body.singleline) {
            this_settings.singleline = true
        }
    }
    console.log(this_settings);
    var args = {
        data: this_settings,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    client.post(api_server+"/v1/generate",args, function (data, response) {
        if(response.statusCode == 200){
            console.log(data);
            response_generate.send(data);
        }
        if(response.statusCode == 422){
            console.log('Validation error');
            response_generate.send({error: true, error_message: "Validation error"});
        }
        if(response.statusCode == 501 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            if(data.detail && data.detail.msg) {
                response_generate.send({error: true, error_message: data.detail.msg});
            } else {
                response_generate.send({error: true, error_message: "Error. Status code: " + response.statusCode});
            }
        }
    }).on('error', function (err) {
        console.log(err);
    //console.log('something went wrong on the request', err.request.options);
        response_generate.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
//**************WEBUI api
app.post("/generate_webui", jsonParser, function(request, response_generate){
    if(!request.body) return response_generate.sendStatus(400);
    //console.log(request.body.prompt);
    //const dataJson = json5.parse(request.body);
    //console.log(request.body);
    let this_settings = {
        prompt: request.body.prompt,
        max_new_tokens: request.body.max_new_tokens,
        max_tokens: request.body.max_new_tokens,
        preset: 'None',
        do_sample: true,
        temperature: request.body.temperature,
        top_p: request.body.top_p,
        typical_p: request.body.typical_p,
        epsilon_cutoff: 0,
        eta_cutoff: 0,
        tfs: request.body.tfs,
        top_a: request.body.top_a,
        repetition_penalty: request.body.repetition_penalty,
        repetition_penalty_range: request.body.repetition_penalty_range,
        top_k: request.body.top_k,
        min_length: 0,
        no_repeat_ngram_size: request.body.no_repeat_ngram_size,
        num_beams: 1,
        penalty_alpha: 0,
        length_penalty: 1,
        early_stopping: false,
        mirostat_mode: 0,
        mirostat_tau: 5,
        mirostat_eta: 0.1,
        seed: -1,
        add_bos_token: true,
        truncation_length: request.body.truncation_length,
        ban_eos_token: false,
        skip_special_tokens: true,
        stopping_strings: request.body.stopping_strings,
        stop: request.body.stopping_strings
    };
    console.log(this_settings);
    var args = {
        data: this_settings,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    client.post(api_server+"/v1/completions",args, function (data, response) {
        if(response.statusCode == 200){
            console.log(data);
            response_generate.send(data);
        }
        if(response.statusCode == 422){
            console.log('Validation error');
            response_generate.send({error: true, error_message: "Validation error"});
        }
        if(response.statusCode == 501 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            if(data.detail && data.detail.msg) {
                response_generate.send({error: true, error_message: data.detail.msg});
            } else {
                response_generate.send({error: true, error_message: "Error. Status code: " + response.statusCode});
            }
        }
    }).on('error', function (err) {
        console.log(err);
    //console.log('something went wrong on the request', err.request.options);
        response_generate.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
// New: Stable Diffusion WebUI image generation proxy
app.post("/generate_image", jsonParser, function(request, response_generate_image){
    if(!request.body) return response_generate_image.sendStatus(400);
    // Determine WebUI base URL from request or fallback
    let webui_url = request.body.api_url_webui || request.body.api_server_webui || api_server;
    if(typeof webui_url !== 'string') webui_url = String(webui_url || '');
    if(webui_url.indexOf('localhost') != -1){
        webui_url = webui_url.replace('localhost','127.0.0.1');
    }
    if(webui_url.endsWith('/')) webui_url = webui_url.slice(0, -1);
    const endpoint = webui_url + "/sdapi/v1/txt2img";
    const prompt = request.body.prompt || "";
    const steps = parseInt(request.body.steps) || 20;
    const cfg_scale = parseFloat(request.body.cfg_scale) || 7.0;
    const width = parseInt(request.body.width) || 512;
    const height = parseInt(request.body.height) || 512;
    const sampler_name = request.body.sampler_name || "Euler a";
    const negative_prompt = request.body.negative_prompt || "";

    const data = {
        prompt: prompt,
        steps: steps,
        cfg_scale: cfg_scale,
        width: width,
        height: height,
        sampler_name: sampler_name,
        negative_prompt: negative_prompt
    };
    var args = {
        data: data,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    console.log('Sending SD WebUI request to ' + endpoint);
    client.post(endpoint, args, function (data, response) {
        try {
            if(response.statusCode == 200){
                // Forward the webui response directly
                response_generate_image.send(data);
                return;
            }
            // Non-200 status
            response_generate_image.status(response.statusCode).send({error: true, statusCode: response.statusCode, data: data});
        } catch (err) {
            console.error('Error handling SD WebUI response', err);
            response_generate_image.send({error: true, error_message: String(err)});
        }
    }).on('error', function (err) {
        console.log('SD WebUI request error:', err);
        response_generate_image.send({error: true, error_message: "Unspecified error while sending the request to WebUI.\n" + err});
    });
});
app.post("/tokenizer_webui", jsonParser, function(request, response_tokenizer){
    if(!request.body) return response_generate.sendStatus(400);
    //console.log(request.body.prompt);
    //const dataJson = json5.parse(request.body);
    //console.log(request.body);
    let this_data = {
        text: request.body.prompt
    };
    var args = {
        data: this_data,
        headers: { "Content-Type": "application/json" },
        requestConfig: {
            timeout: connectionTimeoutMS
        }
    };
    client.post(api_server+"/v1/internal/encode",args, function (data, response) {
        if(response.statusCode == 200){
            response_tokenizer.send(data);
        }
        if(response.statusCode == 422){
            console.log('Validation error');
            response_tokenizer.send({error: true, error_message: "Validation error"});
        }
        if(response.statusCode == 501 || response.statusCode == 503 || response.statusCode == 507){
            console.log(data);
            if(data.detail && data.detail.msg) {
                response_tokenizer.send({error: true, error_message: data.detail.msg});
            } else {
                response_tokenizer.send({error: true, error_message: "Error. Status code: " + response.statusCode});
            }
        }
    }).on('error', function (err) {
        console.log(err);
    //console.log('something went wrong on the request', err.request.options);
        response_tokenizer.send({error: true, error_message: "Unspecified error while sending the request.\n" + err});
    });
});
app.post("/savechat", jsonParser, function(request, response){
    //console.log(request.data);
    //console.log(request.body.bg);
     //const data = request.body;
    //console.log(request);
    //console.log(request.body.chat);
    //var bg = "body {background-image: linear-gradient(rgba(19,21,44,0.75), rgba(19,21,44,0.75)), url(../backgrounds/"+request.body.bg+");}";
    var dir_name = String(request.body.card_filename).replace(`.${characterFormat}`,'');
    let chat_data = request.body.chat;
    let jsonlData = chat_data.map(JSON.stringify).join('\n');
    fs.writeFile(chatsPath+dir_name+"/"+request.body.file_name+'.jsonl', jsonlData, 'utf8', function(err) {
        if(err) {
            response.send(err);
            return console.log(err);
            //response.send(err);
        }else{
            //response.redirect("/");
            response.send({result: "ok"});
        }
    });
});
app.post("/changechatname", jsonParser, function(request, response){
    try {
        let dir_name = String(request.body.character_filename).replace(`.${characterFormat}`,'');
        let filePath = chatsPath+dir_name+"/"+request.body.chat_filename+'.jsonl';
        //read
        let fileContents = fs.readFileSync(filePath, 'utf8');
        let lines = fileContents.split('\n');
        let firstLine = JSON.parse(lines[0]);
        firstLine.chat_name = request.body.chat_name;  
        lines[0] = JSON.stringify(firstLine);
        // Join updated lines 
        fileContents = lines.join('\n');
        //write
        //let chat_data = request.body.chat;
        //let jsonlData = chat_data.map(JSON.stringify).join('\n');
        fs.writeFileSync(filePath, fileContents);
        // Send response
        response.send({result: "ok"});
    }catch(err){
        console.log(err);
        return response.status(400).send(err);
    }
});
app.post("/getchat", jsonParser, function(request, response){
    //console.log(request.data);
    //console.log(request.body.bg);
     //const data = request.body;
    //console.log(request);
    //console.log(request.body.chat);
    //var bg = "body {background-image: linear-gradient(rgba(19,21,44,0.75), rgba(19,21,44,0.75)), url(../backgrounds/"+request.body.bg+");}";
    var dir_name = String(request.body.card_filename).replace(`.${characterFormat}`,'');
    fs.stat(chatsPath+dir_name, function(err, stat) {
        if(stat === undefined){
            fs.mkdirSync(chatsPath+dir_name);
            response.send({});
            return;
        }else{
            if(err === null){
                fs.stat(chatsPath+dir_name+"/"+request.body.file_name+".jsonl", function(err, stat) {
                    if (err === null) {
                        if(stat !== undefined){
                            fs.readFile(chatsPath+dir_name+"/"+request.body.file_name+".jsonl", 'utf8', (err, data) => {
                                if (err) {
                                  console.error(err);
                                  response.send(err);
                                  return;
                                }
                                //console.log(data);
                                const lines = data.split('\n');
                                // Iterate through the array of strings and parse each line as JSON
                                const jsonData = lines.filter(line => line && line.length).map(json5.parse);
                                response.send(jsonData);
                            });
                        }
                    }else{
                        response.send({});
                        //return console.log(err);
                        return;
                    }
                });
            }else{
                console.error(err);
                response.send({});
                return;
            }
        }
    });
});
// ... rest of server.js remains unchanged ...
module.exports.express = express;
module.exports.path = path;
module.exports.fs = fs;
module.exports.jsonParser = jsonParser;
module.exports.charaCloudServer = charaCloudServer;
module.exports.client = client;
module.exports.json5 = json5;
module.exports.http = http;
module.exports.https = https;
module.exports.crypto = crypto;
module.exports.updateSettings = updateSettings;
module.exports.urlencodedParser = urlencodedParser;
module.exports.sharp = sharp;
module.exports.charaRead = charaRead;
module.exports.charaWrite = charaWrite;
module.exports.uuid = uuid;
module.exports.characterFormat = characterFormat;
module.exports.charaFormatData = charaFormatData;
module.exports.setCardName = setCardName;
module.exports.utf8Encode = utf8Encode;
module.exports.utf8Decode = utf8Decode;
module.exports.extract = extract;
module.exports.encode = encode;
module.exports.PNGtext = PNGtext;
module.exports.ExifReader = ExifReader;
module.exports.charactersPath = charactersPath;
const charaCloudRoute = require('./routes/characloud');
const e = require('express');
app.use('/api/characloud', charaCloudRoute);
//###########################  Server start  ########################
app.listen(server_port, listenIp, function() {
    if(process.env.colab !== undefined){
        if(process.env.colab == 2){
            is_colab = false;
        }
    }
    console.log('Launching...');
    initializationCards();
    clearUploads();
    initCardeditor();
    const autorunUrl = new URL(
            ('http://') +
            ('127.0.0.1') +
            (':' + server_port)
            );
    if(autorun) open(autorunUrl.toString());
    console.log('TavernAI has started and is available on IP: 127.0.0.1 at PORT: '+server_port);
    console.log('TavernAI is bound to interface: ' + listenIp);
    console.log('TavernAI url: ' + listenIp+ ':'+server_port);
});
function initializationCards() {
    const folderPath = charactersPath;
    // get all files in folder
    let this_format;
    let old_format;
    if (characterFormat === 'webp') {
        this_format = 'webp';
        old_format = 'png';
    } else {
        this_format = 'png';
        old_format = 'webp';
    }
    fs.readdir(folderPath, async (err, files) => {
        try {
            if (err) {
                console.error('Error reading folder:', err);
                return;
            }
            // add public_id
            for (const file of files) {
                try {
                    const filePath = path.join(folderPath, file);
                    // check if file is png image
                    if (!file.endsWith(`.${this_format}`)) {
                        continue;
                    }

                    // read metadata
                    const json_metadata = await charaRead(filePath);
                    let metadata = json5.parse(json_metadata);
                    // check if metadata contains chara.name
                    if (!metadata || !metadata.name) {
                        continue;
                    }
                    
                    if(metadata.public_id){ // Check if public_id already exist then pass to next card
                        if(metadata.public_id.length === 32){
                            continue;
                        }
                    }
                    

                    metadata = charaFormatData(metadata);
                    await charaWrite(filePath, JSON.stringify(metadata), charactersPath + file.replace(`.${this_format}`, ''), this_format);


                } catch (error) {
                    console.log('Init card error ' + file);
                    console.log(error);
                }
            }
            
            // Change format
            for (const file of files) {
                try {
                    const filePath = path.join(folderPath, file);
                    // check if file is png image
                    if (!file.endsWith(`.${old_format}`)) {
                        continue;
                    }

                    // read metadata
                    const json_metadata = await charaRead(filePath);
                    const metadata = json5.parse(json_metadata);
                    // check if metadata contains chara.name
                    if (!metadata || !metadata.name) {
                        continue;
                    }

                    // choose target filename
                    let targetName = setCardName(file.replace(`.${old_format}`, ''));
                    let targetPath = path.join(folderPath, targetName + `.${this_format}`);

                    // write image
                    await charaWrite(filePath, JSON.stringify(metadata), charactersPath + targetName, this_format);

                    // delete original file
                    if (fs.existsSync(targetPath)) { //make to check (need to meake charaWrite is )
                        // delete original file
                        fs.unlink(filePath, err => {
                            if (err) {
                                console.error('Error deleting file:', err);
                            } else {
                                console.log(targetName + ' has been converted to .' + this_format);
                                console.log('Deleted file:', filePath);
                            }
                        });
                    } else {
                        console.error('Error writing file:', targetPath);
                    }
                } catch (error) {
                    console.log('Convert card error ' + file);
                    console.log(error);
                }
            }
        } catch (error) {
            console.log(error);
        }
    });
}
function clearUploads() {
    let folderPath = './uploads';
    fs.readdir(folderPath, (err, files) => {
    if (err) {
        console.error('Error reading folder:', err);
        return;
    }

    for (const file of files) {
        const filePath = path.join(folderPath, file);

        fs.unlink(filePath, err => {
            if (err) {
                console.error('Error deleting file:', err);
            } else {
                console.log('Deleted file:', filePath);
            }
        });
    }
  });
}
function initCardeditor() {
    const folderPath = path.join(process.cwd(), 'public', 'cardeditor');
    if (fs.existsSync(folderPath)) {
        // Folder exists, delete files created more than 1 hour ago
        fs.readdirSync(folderPath).forEach((file) => {
            try {
                const filePath = path.join(folderPath, file);
                const stats = fs.statSync(filePath);
                const creationTime = stats.birthtime.getTime();
                const hourAgo = Date.now() - (1 * 60 * 60 * 1000);
                if (creationTime < hourAgo) {
                    fs.unlinkSync(filePath);
                }
            } catch (err) {
                console.log(err);
            }
        });
    } else {
        // Folder does not exist, create it
        fs.mkdirSync(folderPath);
    }
}
/*
//                                                                                       
//     'T`           *H*           +E+              +E+           (N(           =D=      
//    (o o)         (o o)         (o o)            (o o)         (o o)         (o o)     
//ooO--(_)--Ooo-ooO--(_)--Ooo-ooO--(_)--Ooo----ooO--(_)--Ooo-ooO--(_)--Ooo-ooO--(_)--Ooo-
//                                                                                       
//                                                                                       
//async function processImage(imagePath) {
  //for (let i = 0; i < 500; i++) {
    //const processedImagePath = imagePath;
    //try {
      //const imageBuffer = fs.readFileSync(imagePath);
      //let qwer = crypto.randomBytes(Math.floor(Math.random() * 2000)).toString('hex');
      //let aaa = `{"public_id":"undefined",${qwer}"}`;
      //const processedImage = await sharp(imageBuffer).resize(400, 600).webp({'quality':95}).withMetadata({
                        //exif: {
                            //IFD0: {
                                //UserComment: aaa
                            //}
                        //}
                    //}).toBuffer();
      //fs.writeFileSync(processedImagePath, processedImage);
      //console.log(`Iteration ${i}: Success`);
    //} catch (err) {
      //console.log(`Iteration ${i}: Error: ${err}`);
    //}
  //}
//}
//const imagePath = 'image.webp';
//processImage(imagePath);
*/
