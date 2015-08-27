import Ember from 'ember';

export default Ember.Route.extend({
  model() {
    // TODO: Get this stuff the remote.

    const store = this.store;

    const events = [
      store.createRecord('event', {
        temp:    10,
        seconds: 1000,
      }),
    ];

    return [
      store.createRecord('schedule', {
        name:   'bedroom',
        events: events,
      }),
    ];
  },
});
