'use strict';

const miio = require('miio');
const version = require('./package.json').version;
let Service;
let Characteristic;
let logger;

module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;

	homebridge.registerAccessory('homebridge-xiaomi-purifier', 'MiAirPurifier', MiAirPurifier);
}

function MiAirPurifier(log, config) {
	logger = log;

	this.services = [];
	this.name = config.name || 'Air Purifier';
	this.ip = config.ip;
	this.token = config.token;
	this.showAirQuality = config.showAirQuality || false;
	this.showTemperature = config.showTemperature || false;
	this.showHumidity = config.showHumidity || false;
	this.enableLED = config.enableLED || false;
	this.enableBuzzer = config.enableBuzzer || false;
	this.device = undefined;
	this.mode = undefined;
	this.temperature = undefined;
	this.humidity = undefined;
	this.aqi = undefined;

	//Korea PM 2.5 standard value
	this.levels = [
		[76, Characteristic.AirQuality.POOR],
		[36, Characteristic.AirQuality.INFERIOR],
		[16, Characteristic.AirQuality.FAIR],
		[6, Characteristic.AirQuality.GOOD],
		[0, Characteristic.AirQuality.EXCELLENT]
	];

	if (!this.ip) {
		throw new Error('Your must provide IP address of the Air Purifier.');
	}

	if (!this.token) {
		throw new Error('Your must provide token of the Air Purifier.');
	}

	this.service = new Service.AirPurifier(this.name);
	this.service.addOptionalCharacteristic(Characteristic.FilterLifeLevel);
	this.service.addOptionalCharacteristic(Characteristic.FilterChangeIndication);

	this.service
		.getCharacteristic(Characteristic.Active)
		.on('get', this.getActiveState.bind(this))
		.on('set', this.setActiveState.bind(this));

	this.service
		.getCharacteristic(Characteristic.CurrentAirPurifierState)
		.on('get', this.getCurrentAirPurifierState.bind(this));

	this.service
		.getCharacteristic(Characteristic.TargetAirPurifierState)
		.on('get', this.getTargetAirPurifierState.bind(this))
		.on('set', this.setTargetAirPurifierState.bind(this));

	this.service
		.getCharacteristic(Characteristic.LockPhysicalControls)
		.on('get', this.getLockPhysicalControls.bind(this))
		.on('set', this.setLockPhysicalControls.bind(this));

	this.service
		.getCharacteristic(Characteristic.RotationSpeed)
		.on('get', this.getRotationSpeed.bind(this))
		.on('set', this.setRotationSpeed.bind(this));

	this.service
		.getCharacteristic(Characteristic.FilterLifeLevel)
		.on('get', this.getFilterState.bind(this));

	this.service
		.getCharacteristic(Characteristic.FilterChangeIndication)
		.on('get', this.getFilterChangeState.bind(this));

	this.serviceInfo = new Service.AccessoryInformation();

	this.serviceInfo
		.setCharacteristic(Characteristic.Manufacturer, 'Xiaomi')
		.setCharacteristic(Characteristic.Model, 'Air Purifier')
		.setCharacteristic(Characteristic.SerialNumber, this.token.toUpperCase())
		.setCharacteristic(Characteristic.FirmwareRevision, version);

	this.services.push(this.service);
	this.services.push(this.serviceInfo);

	if (this.showAirQuality) {
		this.airQualitySensorService = new Service.AirQualitySensor(this.name + ' Air Quality');

		this.airQualitySensorService
			.getCharacteristic(Characteristic.AirQuality)
			.on('get', this.getAirQuality.bind(this));

		this.airQualitySensorService
			.getCharacteristic(Characteristic.PM2_5Density)
			.on('get', this.getPM25.bind(this));

		this.services.push(this.airQualitySensorService);
	}

	if (this.showTemperature) {
		this.temperatureSensorService = new Service.TemperatureSensor(this.name + ' Temperature');

		this.temperatureSensorService
			.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', this.getTemperature.bind(this));

		this.services.push(this.temperatureSensorService);
	}

	if (this.showHumidity) {
		this.humiditySensorService = new Service.HumiditySensor(this.name + ' Humidity');

		this.humiditySensorService
			.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.getHumidity.bind(this));

		this.services.push(this.humiditySensorService);
	}

	if (this.enableLED) {
		this.lightBulbService = new Service.Lightbulb(this.name + ' LED');

		this.lightBulbService
			.getCharacteristic(Characteristic.On)
			.on('get', this.getLED.bind(this))
			.on('set', this.setLED.bind(this));

		this.services.push(this.lightBulbService);
	}

	if (this.enableBuzzer) {
		this.switchService = new Service.Switch(this.name + ' Buzzer');

		this.switchService
			.getCharacteristic(Characteristic.On)
			.on('get', this.getBuzzer.bind(this))
			.on('set', this.setBuzzer.bind(this));

		this.services.push(this.switchService);
	}

	this.discover();
}

MiAirPurifier.prototype = {
	discover: function () {
		const that = this;

		miio.device({
				address: that.ip,
				token: that.token
			})
			.then(device => {
				/*
				MiioDevice {
					model=zhimi.airpurifier.v6,
					types=miio:air-purifier, sensor, miio, air-purifier,
					capabilities=miio:buzzer, miio:led-brightness, miio:switchable-led, pm2.5, relative-humidity, temperature, switchable-mode, mode, switchable-power, restorable-state, power, state
				}
				*/
				if (device.matches('type:air-purifier')) {
					that.device = device;

					logger.debug('Discovered Mi Air Purifier (%s) at %s', device.miioModel, that.ip);
					logger.debug('Model       : ' + device.miioModel);
					logger.debug('Power       : ' + device.property('power'));
					logger.debug('Mode        : ' + device.property('mode'));
					logger.debug('Temperature : ' + device.property('temperature'));
					logger.debug('Humidity    : ' + device.property('humidity'));
					logger.debug('Air Quality : ' + device.property('aqi'));
					logger.debug('LED         : ' + device.property('led'));

					// Listen to mode change event
					device.on('modeChanged', mode => {
						//that.updateActiveState(mode);
						that.updateTargetAirPurifierState(mode);
						//that.updateCurrentAirPurifierState(mode);
					});

					// Listen to air quality change event
					if (that.showAirQuality) {
						device.on('pm2.5Changed', value => {
							that.updateAirQuality(value);
						});
					}

					// Listen to temperature change event
					if (that.showTemperature) {
						// Read the temperature
						device.temperature()
							.then(temperature => {
								that.updateTemperature(temperature.celsius);
							})
							.catch(error => {
								logger.debug(error);
							});
						device.on('temperatureChanged', temperature => {
							that.updateTemperature(temperature.celsius);
						});
					}

					// Listen to humidity change event
					if (that.showHumidity) {
						// Read the relative humidity
						device.relativeHumidity()
							.then(result => {
								that.updateHumidity(result);
							})
							.catch(error => {
								logger.debug(error);
							});
						device.on('relativeHumidityChanged', value => {
							that.updateHumidity(value);
						});
					}
				} else {
					logger.debug('Device discovered at %s is not Mi Air Purifier', this.ip);
				}
			})
			.catch(error => {
				logger.debug('Failed to discover Mi Air Purifier at %s', this.ip);
				logger.debug('Will retry after 30 seconds');

				setTimeout(function () {
					that.discover();
				}, 30000);
			});
	},

	getActiveState: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		this.device.power()
			.then(state => {
				logger.debug('getActiveState: State -> %s', state);
				callback(null, state);
			})
			.catch(error => {
				callback(error);
			});
	},

	setActiveState: function (state, callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		const that = this;

		logger.debug('setActiveState: %s', state);

		this.device.setPower(state)
			.then(isOn => {
				that.updateActiveState(that.mode);
				that.updateCurrentAirPurifierState(this.mode);
			})
			.catch(error => {
				callback(error);
			});
	},

	updateActiveState: async function (mode) {
		this.mode = mode;

		const isOn = await this.device.power();
		let state = isOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;

		if (isOn) {
			logger.debug('updateActiveState: Mode ->  %s', mode);
			state = (mode != 'idle') ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
		}

		logger.debug('updateActiveState: State -> %s', state);

		this.service.getCharacteristic(Characteristic.Active).updateValue(state);
	},

	getCurrentAirPurifierState: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		this.device.power()
			.then(isOn => {
				logger.debug('getCurrentAirPurifierState: State -> %s', (isOn ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR : Characteristic.CurrentAirPurifierState.INACTIVE));
				callback(null, isOn ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR : Characteristic.CurrentAirPurifierState.INACTIVE);
			})
			.catch(error => {
				callback(error);
			});
	},

	updateCurrentAirPurifierState: async function (mode) {
		this.mode = mode;

		const isOn = await this.device.power();
		let state = isOn ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR : Characteristic.CurrentAirPurifierState.INACTIVE;

		if (isOn) {
			logger.debug('updateCurrentAirPurifierState: Mode ->  %s', mode);
			state = (mode == 'idle') ? Characteristic.CurrentAirPurifierState.INACTIVE : Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
		}

		logger.debug('getCurrentAirPurifierState: State -> %s', state);

		this.service.getCharacteristic(Characteristic.CurrentAirPurifierState).updateValue(state);
	},

	getTargetAirPurifierState: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		const state = (this.mode != 'favorite') ? Characteristic.TargetAirPurifierState.AUTO : Characteristic.TargetAirPurifierState.MANUAL;

		logger.debug('getTargetAirPurifierState: Mode -> %s', this.mode);
		logger.debug('getTargetAirPurifierState: State -> %s', state);

		callback(null, state);
	},

	setTargetAirPurifierState: function (state, callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		const mode = (state) ? 'auto' : 'favorite';
		this.mode = mode;

		logger.debug('setTargetAirPurifierState: %s', mode);

		this.device.setMode(mode)
			.then(mode => {
				callback(null);
			})
			.catch(error => {
				callback(error);
			});
	},

	updateTargetAirPurifierState: function (mode) {
		this.mode = mode;
		const state = (mode != 'favorite') ? Characteristic.TargetAirPurifierState.AUTO : Characteristic.TargetAirPurifierState.MANUAL;

		logger.debug('updateTargetAirPurifierState: Mode -> %s', mode);
		logger.debug('updateTargetAirPurifierState: State -> %s', state);

		this.service.getCharacteristic(Characteristic.TargetAirPurifierState).updateValue(state);
	},

	getLockPhysicalControls: async function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		await this.device.call('get_prop', ['child_lock'])
			.then(result => {
				const state = (result[0] === 'on') ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;

				logger.debug('getLockPhysicalControls: %s', state);
				
				callback(null, state);
			})
			.catch(error => {
				callback(error);
			});
	},

	setLockPhysicalControls: async function (state, callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('setLockPhysicalControls: %s', state);

		await this.device.call('set_child_lock', [(state) ? 'on' : 'off'])
			.then(result => {
				(result[0] === 'ok') ? callback(): callback(new Error(result[0]));
			})
			.catch(error => {
				callback(error);
			});
	},

	getRotationSpeed: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}
		level = this.device.property("favorite_level")
		logger.debug('favorite_level: %s', level);

		const speed = Math.ceil(level * 6.25);
		logger.debug('getRotationSpeed: %s', speed);
		callback(null, speed);
	},

	setRotationSpeed: function (speed, callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		// Overwirte to manual mode
		if (this.mode != 'favorite') {
			this.device.setMode('favorite')
				.then()
				.catch(err => {
					callback(err);
				});
		}

		// Set favorite level
		const level = Math.ceil(speed / 6.25);

		logger.debug('setRotationSpeed: %s', level);

		this.device.changeFavorite(level)
			.then(mode => {
				callback(null);
			})
			.catch(error => {
				callback(error);
			});
	},

	getFilterState: function (callback) {
		if(!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		callback(null, this.device.property("filterLifeRemaining"));
	},

	getFilterChangeState: function (callback) {
		if(!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		callback(null, (this.device.property("filterLifeRemaining") < 5) ? Characteristic.FilterChangeIndication.CHANGE_FILTER : Characteristic.FilterChangeIndication.FILTER_OK);
	},

	getAirQuality: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('getAirQuality: %s', this.aqi);

		for (var item of this.levels) {
			if (this.aqi >= item[0]) {
				callback(null, item[1]);
				return;
			}
		}
	},

	updateAirQuality: function (value) {
		if (!this.showAirQuality) {
			return;
		}

		this.aqi = value;

		logger.debug('updateAirQuality: %s', value);

		this.updatePM25(value);
		
		for (var item of this.levels) {
			if (value >= item[0]) {
				this.airQualitySensorService.getCharacteristic(Characteristic.AirQuality).updateValue(item[1]);
				return;
			}
		}
	},

	getPM25: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('getPM25: %s', this.aqi);

		callback(null, this.aqi);
	},

	updatePM25: function (value) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('updatePM25: %s', value);

		this.airQualitySensorService.getCharacteristic(Characteristic.PM2_5Density).updateValue(value);
	},

	getTemperature: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('getTemperature: %s', this.temperature);

		callback(null, this.temperature);
	},

	updateTemperature: function (value) {
		if (!this.showTemperature) {
			return;
		}

		this.temperature = value;

		logger.debug('updateTemperature: %s', value);

		this.temperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(value);
	},

	getHumidity: function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('getHumidity: %s', this.humidity);

		callback(null, this.humidity);
	},

	updateHumidity: function (value) {
		if (!this.showHumidity) {
			return;
		}

		this.humidity = value;

		logger.debug('updateHumidity: %s', value);

		this.humiditySensorService.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(value);
	},

	getLED: async function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		const state = await this.device.led();

		logger.debug('getLED: %s', state);

		callback(null, state);
	},

	setLED: async function (state, callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('setLED: %s', state);

		await this.device.led(state)
			.then(state => {
				callback(null);
			})
			.catch(error => {
				callback(error);
			});
	},

	getBuzzer: async function (callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		const state = await this.device.buzzer();
		
		logger.debug('getBuzzer: %s', state);
		
		callback(null, state);
	},

	setBuzzer: async function (state, callback) {
		if (!this.device) {
			callback(new Error('No Air Purifier is discovered.'));
			return;
		}

		logger.debug('setBuzzer: %s', state);

		await this.device.buzzer(state)
			.then(state => {
				callback(null);
			})
			.catch(error => {
				callback(error);
			});
	},

	identify: function (callback) {
		callback();
	},

	getServices: function () {
		return this.services;
	}
};
