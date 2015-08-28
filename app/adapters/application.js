import Ember from 'ember';
import DS from 'ember-data';

const remoteUrl = 'http://192.168.1.31/cgi-bin/cmh/gladys_relay.sh/';
const database  = {};

const remoteMap = {
  'gladys@model:schedule-list:': {
    type: 'schedule-list',
    skip: true,
  },
  'gladys@model:schedule:': {
    type: 'schedule',
    flattenDown: {
      events: 'gladys@model:event:',
    },
  },
  'gladys@model:event:': {
    type:       'event',
    sendParent: 'gladys@model:schedule:',
  },
};

const sendRequest = function(data, dataType) {
  return new Ember.RSVP.Promise(function(resolve, reject) {
    var config = {
      type: 'GET',
      url:  remoteUrl,
      data: data,
    };

    if (dataType) {
      config.dataType = dataType;
    }

    console.log(data);
    console.log(config);

    Ember.$.ajax(config).then(function(data) {
      console.log(data);

      Ember.run(null, resolve, data);
    }, function(jqXHR) {
      console.log('error');
      console.log(jqXHR);

      jqXHR.then = null;
      Ember.run(null, reject, jqXHR);
    });
  });
};

const clearRemote = function(remoteType) {
  const data = {
    op:   'clear',
    name: remoteType,
  };

  return sendRequest(data);
};

const saveRemote = function(remoteType) {
  const data = {
    op:   'save',
    name: remoteType,
  };

  return sendRequest(data);
};

const flattenData = function(data, remoteConfig) {
  const rawData = _.clone(data);

  if (remoteConfig.flattenDown) {
    _.each(rawData, function(datum, id) {
      datum = _.clone(datum);
      rawData[id] = datum;

      _.each(remoteConfig.flattenDown, function(type, key) {
        if (!datum[key]) {
          return;
        }

        datum[key] = _.clone(datum[key]);

        _.each(datum[key], function(id, j) {
          const newValue = database[type][id];

          datum[key][j] = newValue;
        });
      });
    });
  }

  return rawData;
};

const inflateData = function(data, localType) {
  const remoteConfig = remoteMap[localType];

  if (!database[localType]) {
    database[localType] = {};
  }

  _.each(data, function(datum) {
    _.each(remoteConfig.flattenDown, function(type, key) {
      if (!database[type]) {
        database[type] = {};
      }

      _.each(datum[key], function(record, j) {
        const id = record.id;

        database[type][id] = record;

        datum[key][j] = id;
      });
    });

    database[localType][datum.id] = datum;
  });

  console.log(database);
};

const updateRemote = function(localType) {
  const remoteConfig = remoteMap[localType];

  if (remoteConfig.skip) {
    return;
  }

  if (remoteConfig.sendParent) {
    return updateRemote(remoteConfig.sendParent);
  }

  const sendChunks = function(dataString, totalSent, doneCallback) {
    const chunk     = dataString.slice(0, 4000);
    const remainder = dataString.slice(4000);

    totalSent += chunk.length;

    const data = {
      op:   'append',
      data: chunk,
    };

    sendRequest(data).then(function(resp) {
      if (parseInt(resp) !== totalSent) {
        // FIXME: An error has occurred. Retry.
        return;
      }

      if (remainder) {
        sendChunks(remainder, totalSent, doneCallback);
      } else {
        doneCallback(totalSent);
      }
    });
  };

  const remoteType = remoteMap[localType].type;
  const rawData    = flattenData(database[localType], remoteConfig);
  const dataString = JSON.stringify(_.values(rawData));

  // FIXME: This doesn't return the right promise.
  // FIXME: Check this is returning the right response.
  return clearRemote(remoteType).then(function() {
    sendChunks(dataString, 0, function() {
      // FIXME: Check this is returning the right response.
      saveRemote(remoteType);
    });
  });
};

const updateLocal = function(localType) {
  const remoteConfig = remoteMap[localType];

  if (remoteConfig.skip) {
    return;
  }

  if (remoteConfig.sendParent) {
    return updateLocal(remoteConfig.sendParent);
  }

  const params = {
    op:   'get',
    name: remoteConfig.type,
  };

  return new Ember.RSVP.Promise(function(resolve, reject) {
    sendRequest(params, 'json').then(function(data) {
      inflateData(data || [], localType);

      resolve(_.values(database[localType]));
    }, reject);
  });
};

export default DS.Adapter.extend({
  generateIdForRecord() {
    return cuid();
  },

  createRecord(store, type, snapshot) {
    const data = {};
    const serializer = store.serializerFor(type.modelName);

    serializer.serializeIntoHash(data, type, snapshot, { includeId: true });

    const localType = type.toString();

    if (!database[localType]) {
      database[localType] = {};
    }

    database[localType][snapshot.id] = data;

    return updateRemote(localType);
  },

  updateRecord(store, type, snapshot) {
    return this.createRecord(store, type, snapshot);
  },

  deleteRecord(store, type, snapshot) {
    const localType = type.toString();

    if (database[localType]) {
      delete database[localType][snapshot.id];
    }

    return updateRemote(localType);
  },

  findAll(store, type) {
    return updateLocal(type.toString());
  },

  findRecord(store, type, id) {
    const localType = type.toString();

    return new Ember.RSVP.Promise(function(resolve, reject) {
      updateLocal(localType).then(function() {
        resolve(database[localType][id]);
      }, reject);
    });
  },

  // TODO
  query() {

  },
});
