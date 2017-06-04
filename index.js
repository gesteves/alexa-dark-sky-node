const Alexa = require('alexa-sdk');
const Imgix = require('imgix-core-js');
const request = require('request-promise-native');
const imgix = new Imgix({
  host: process.env.IMGIX_DOMAIN,
  secureURLToken: process.env.IMGIX_TOKEN
});

exports.handler = function (event, context, callback) {
  const alexa = Alexa.handler(event, context);
  alexa.appId = process.env.ALEXA_APP_ID;
  alexa.dynamoDBTableName = process.env.DYNAMODB_TABLE;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

const handlers = {
  'LaunchRequest': launchRequestHandler,
  'LocationForecastIntent': locationForecastIntentHandler,
  'EchoForecastIntent': echoForecastIntentHandler,
  'TemperatureIntent': temperatureIntentHandler,
  'AMAZON.StopIntent': stopIntentHandler,
  'AMAZON.CancelIntent': cancelIntentHandler,
  'AMAZON.HelpIntent': helpIntentHandler,
  'Unhandled': unhandledIntentHandler
};

/*
  INTENT HANDLERS
*/

// Launch request, i.e. "Alexa, open Dark Sky"
function launchRequestHandler () {
  this.attributes.consent_token = this.event.session.user.permissions.consentToken;
  this.emit(':ask', 'What do you want to know?', "I'm sorry, could you say that again?");
}

// Handle a forecast intent when the user has not included a location ("what's the weather").
// In this case, get the forecast for the address set in the Echo, using the consent token.
// TODO: Handle the case where the address is not set or the user hasn't granted permission.
function echoForecastIntentHandler() {
  let device_id = this.event.context.System.device.deviceId;
  let consent_token = this.attributes.consent_token;

  getEchoAddress(device_id, consent_token).
    then(geocodeAddress).
    then(getForecast).
    then(forecast => {
      this.emit(':tellWithCard', forecastSsml(forecast), 'Weather Forecast', forecastPlain(forecast), forecastImage(forecast));
    });
}

// Handle a forecast intent when the user has included a city ("what's the weather in DC"),
// or an address ("what's the address in 1600 pennsylvania avenue").
function locationForecastIntentHandler() {
  let location = this.event.request.intent.slots.city.value || this.event.request.intent.slots.address.value;

  geocodeAddress(location).
    then(getForecast).
    then(forecast => {
      this.emit(':tellWithCard', forecastSsml(forecast), 'Weather Forecast', forecastPlain(forecast), forecastImage(forecast));
    });
}

// Returns the current, high, and low temperature at the Echo's location
// TODO: Handle the case where the address is not set or the user hasn't granted permission.
function temperatureIntentHandler() {
  let device_id = this.event.context.System.device.deviceId;
  let consent_token = this.attributes.consent_token;

  getEchoAddress(device_id, consent_token).
    then(geocodeAddress).
    then(getForecast).
    then(forecast => {
      this.emit(':tell', temperatureSsml(forecast));
    });
}

function stopIntentHandler() {
  this.emit(':tell', "Okay");
}

function cancelIntentHandler() {
  this.emit(':tell', "Okay");
}

function helpIntentHandler() {
  this.emit(':ask', "To get the forecast for your current location, ask 'how's the weather'. You can also specify a location, like 'how's the weather in new york'");
}

function unhandledIntentHandler() {
  this.emit(':ask', "I didn't get that. To get the forecast for your current location, ask 'how's the weather'. You can also specify a location, like 'how's the weather in new york'");
}

/*
  HELPER FUNCTIONS
*/

function getEchoAddress(device_id, consent_token) {
  let opts = {
    url: `https://api.amazonalexa.com/v1/devices/${device_id}/settings/address`,
    headers: {
      'Authorization': `Bearer ${consent_token}`
    },
    json: true
  };
  return request(opts).then(echoAddressToString);
}

function geocodeAddress(address) {
  let opts = {
    url: `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.MAPS_API_KEY}`,
    json: true
  };
  return request(opts).then(geocoded_address => {
    if (geocoded_address.status === 'OK') {
      return {
        latitude: geocoded_address.results[0].geometry.location.lat,
        longitude: geocoded_address.results[0].geometry.location.lng,
        address: geocoded_address.results[0].formatted_address
      };
    }
  });
}

function getForecast(geocoded_address) {
  let opts = {
    url: `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${geocoded_address.latitude},${geocoded_address.longitude}`,
    json: true
  };
  return request(opts).then(forecast => {
    forecast.address = geocoded_address.address;
    return forecast;
  });
}

// Format the Dark Sky forecast into a spoken sentence using SSML.
function forecastSsml(forecast) {
  let text = `<p>Here's the forecast for <say-as interpret-as="address">${forecast.address}</say-as></p>`;

  if (forecast.currently) {
    let now = forecast.currently;
    if (Math.round(now.temperature) === Math.round(now.apparentTemperature)) {
      text += `<p>Right now: ${now.summary}, ${Math.round(now.temperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.</p>`;
    } else {
      text += `<p>Right now: ${now.summary}, ${Math.round(now.temperature)}°, but it feels like ${Math.round(now.apparentTemperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.</p>`;
    }
  }

  if (forecast.minutely) {
    text += `<p>Next hour: ${forecast.minutely.summary}</p>`;
  }

  if (forecast.hourly) {
    let apparentTemperatures = forecast.hourly.data.map(d => d.apparentTemperature);
    let high = Math.round(Math.max(...apparentTemperatures));
    let low = Math.round(Math.min(...apparentTemperatures));
    text += `<p>Next 24 hours: ${forecast.hourly.summary.replace(/\.$/, '')}, with a high of ${high}° and a low of ${low}°.</p>`;
  }

  if (forecast.daily) {
    text += `<p>Next 7 days: ${forecast.daily.summary}</p>`;
  }

  return text;
}

// Format the Dark Sky forecast into plain text.
function forecastPlain(forecast) {
  let text = `Here's the forecast for ${forecast.address}`;

  if (forecast.currently) {
    let now = forecast.currently;
    if (Math.round(now.temperature) === Math.round(now.apparentTemperature)) {
      text += `\nRight now: ${now.summary}, ${Math.round(now.temperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.`;
    } else {
      text += `\nRight now: ${now.summary}, ${Math.round(now.temperature)}°, but it feels like ${Math.round(now.apparentTemperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.`;
    }
  }

  if (forecast.minutely) {
    text += `\nNext hour: ${forecast.minutely.summary}`;
  }

  if (forecast.hourly) {
    let apparentTemperatures = forecast.hourly.data.map(d => d.apparentTemperature);
    let high = Math.round(Math.max(...apparentTemperatures));
    let low = Math.round(Math.min(...apparentTemperatures));
    text += `\nNext 24 hours: ${forecast.hourly.summary.replace(/\.$/, '')}, with a high of ${high}° and a low of ${low}°.`;
  }

  if (forecast.daily) {
    text += `\nNext 7 days: ${forecast.daily.summary}`;
  }

  return text;
}

function temperatureSsml(forecast) {
  let text = '';

  if (forecast.currently) {
    let now = forecast.currently;
    if (Math.round(now.temperature) === Math.round(now.apparentTemperature)) {
      text += `<p>It's ${Math.round(now.temperature)}° right now.</p>`;
    } else {
      text += `<p>It's ${Math.round(now.temperature)}° right now, but it feels like ${Math.round(now.apparentTemperature)}°.</p>`;
    }
  }

  if (forecast.hourly) {
    let apparentTemperatures = forecast.hourly.data.map(d => d.apparentTemperature);
    let high = Math.round(Math.max(...apparentTemperatures));
    let low = Math.round(Math.min(...apparentTemperatures));
    text += `\nThe high for today is ${high}°, and the low is ${low}°.`;
  }

  return text;
}

// Returns an image object with the forecast icon
function forecastImage(forecast) {
 let images = ['clear-day',
               'clear-night',
               'rain',
               'sleet',
               'hail',
               'snow',
               'wind',
               'fog',
               'cloudy',
               'partly-cloudy-day',
               'partly-cloudy-night',
               'thunderstorm',
               'tornado'];

  if (images.includes(forecast.currently.icon)) {
    let url = `https://s3.amazonaws.com/${process.env.S3_BUCKET}/images/${forecast.currently.icon}.png`;
    return {
      smallImageUrl: imgix.buildURL(url, { w: 720 }),
      largeImageUrl: imgix.buildURL(url, { w: 1200 })
    };
  }
}

// Returns the Echo's address as a sentence
function echoAddressToString(address) {
  let location_array = [];
  location_array.push(address.addressLine1);
  location_array.push(address.addressLine2);
  location_array.push(address.addressLine3);
  location_array.push(address.city);
  location_array.push(address.stateOrRegion);
  location_array.push(address.countryCode);
  location_array.push(address.postalCode);
  return location_array.filter(i => i).join(', ');
}
