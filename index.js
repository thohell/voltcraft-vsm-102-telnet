"use strict";

/* ============================================================================
* Imports
* ========================================================================= */
const Telnet = require('telnet-client');
const telnet = new Telnet();

/* ============================================================================
 * Convenience
 * ========================================================================= */
const STX = '\x02';
const ETX = '\x03';
const ACK = '\x06';
const NACK = '\x15';

/* ============================================================================
 * Component state
 * ========================================================================= */
const state = {
  callback: null,
  index: 0,
  options: null,
  frameBuffer: '',
  lineBuffer: '',
}

/* ============================================================================
 * Module entry
 * ========================================================================= */
const run = (options, callback) => {

  /* Stash options */
  state.options = options;
  state.callback = callback;

  if (!('serials' in options)) {
    state.options.serials = [''];
  }

  if (options.verbose === 'undefined') {
    state.options.verbose = false;
  }
  /* We use this just to keep a process going... */
  setInterval(() => { }, 1000);

  /* Just go ahead and start connecting... */
  connect();
};

/* ============================================================================
 * Set state and connect to next device.
 * ========================================================================= */
const connect = () => {
  telnet.connect({
    host: state.options.host,
    port: state.options.port,
    negotiationMandatory: false,
    timeout: 2000,
    debug: true,
    loginPrompt: '',
    passwordPrompt: '',
  })
    .catch(err => { });
};

/* Associated event */
telnet.on('connect', () => {
  state.lineBuffer = '';
  state.frameBuffer = '';

  /* Query device */
  telnet.send(`/?${state.options.serials[state.index]}!`, { ors: '\r\n' });

  /* Get next device */
  state.index = state.index < state.options.serials.length - 1 ? state.index + 1 : 0;
})

/* ============================================================================
 * Disconnect.
 * ========================================================================= */
const disconnect = () => {
  telnet.destroy();
};

/* Associated event */
telnet.on('close', () => {
  connect(); /* Immediatly hammer the next device */
})

/* ============================================================================
 * Handle misc events
 * ========================================================================= */
telnet.on('timeout', () => { disconnect(); }) /* Disconnect on timeout */
telnet.on('error', (err) => { }) /* Squelch errors */

/* ============================================================================
 * Handle incoming data
 * ========================================================================= */
telnet.on('data', (data) => {

  /* Silently disconnect on NAK */
  if (data.length == 1 && data[0] == NACK.charCodeAt[0]) {
    disconnect();
  }

  /* Build line buffer and parse each line as they come */
  state.lineBuffer += data.toString("utf8");
  if (state.lineBuffer.indexOf('\r\n') !== -1) {
    state.lineBuffer.split('\r\n').map(line => {
      parseLine(line);
    })
    state.lineBuffer = '';
  }

})

/* ============================================================================
 * Perform longitudinal redundancy check on buffer.
 * ========================================================================= */
const calculateLrc = (data) => {

  let lrc = 0;

  /* Iterate over (string) buffer and apply LRC */
  data.split('').map(char => {
    const byte = char.charCodeAt(0);
    lrc = (lrc ^ byte) & 0xff;
  })

  return lrc;
};

/* ============================================================================
 * Parse one line from line buffer
 * ========================================================================= */
const parseLine = line => {

  /* Bail of nothing to parse */
  if (!line) {
    return;
  }

  /* First char tells us a lot */
  switch (line[0]) {

    /* Device response. Ready to transmit */
    case '/':
      /* Send ACK + '050' */
      telnet.send(ACK + '050', { ofs: '\r\n' });

      /* Set timestamp to now */
      state.ts = new Date().getTime();
      break;

    /* STX */
    case STX:
      /* Put everything after STX into frame buffer */
      state.frameBuffer += line.slice(1) + '\r\n';
      break;

    /* ETX */
    case ETX:
      /* put ETX into frame buffer */
      state.frameBuffer += ETX;

      /* handle buffer data and disconnect. */
      handleFrameBuffer(state.frameBuffer, line.charCodeAt(1));
      disconnect();
      break;

    default:
      /* Put line into frame buffer */
      state.frameBuffer += line + '\r\n';
  }
};


/* ============================================================================
 * Parse frame buffer
 * ========================================================================= */

const handleFrameBuffer = (data, bcc) => {

  /* Calculate lrc on buffer... */
  const lrc = calculateLrc(data);

  /* ...and bail out if checksum mismatch and __NOT__ in verbose mode. */
  if (!state.options.verbose && (lrc !== bcc)) {
    return;
  }


  /* --------------------------------------------------------------------------
   * Helper mapper object
   * ----------------------------------------------------------------------- */
  const ObisMapper = {
    /* "1-0:0.0.0*255": ['property_number'], */ /* We never use this */
    "1-0:1.8.0*255": { path: ['energy', 'total'], verbose: true },
    "1-0:2.1.7*255": { path: ['energy', 'L1'], verbose: true },
    "1-0:4.1.7*255": { path: ['energy', 'L2'], verbose: true },
    "1-0:6.1.7*255": { path: ['energy', 'L3'], verbose: true },
    "1-0:21.7.255*255": { path: ['power', 'L1'], verbose: false },
    "1-0:41.7.255*255": { path: ['power', 'L2'], verbose: false },
    "1-0:61.7.255*255": { path: ['power', 'L3'], verbose: false },
    "1-0:1.7.255*255": { path: ['power', 'total'], verbose: true },
    "1-0:96.5.5*255": { path: ['state'], verbose: true },
    "0-0:96.1.255*255": { path: ['serial'], verbose: false }
  };

  /* --------------------------------------------------------------------------
   * Helper to recursively put data in object
   * ----------------------------------------------------------------------- */
  const addToResponse = (object, path, verbose, value) => {

    /* Skip verbose data if not state.options.verbose === true */
    if (!state.options.verbose && verbose) {
      return;
    }

    /* If we have sub levels... */
    if (path.length !== 1) {

      /* ...create sub object if needed... */
      if (!(path[0] in object)) {
        object[path[0]] = {};
      }

      /* ...and recurse into it. */
      addToResponse(object[path[0]], path.slice(1), verbose, value);

    } else {

      /* This is the correct level. Stash value. */
      object[path[0]] = value;

    }
  }

  /* Start building our response object */
  const response = { ts: state.ts }

  /* Add checksum data __IF__ in verbose mode */
  addToResponse(response, ['checksum'], true,
    {
      bcc,
      lrc,
      match: lrc === bcc
    })

  /* Add units */
  addToResponse(response, ['power', 'unit'], false, 'kW');
  addToResponse(response, ['energy', 'unit'], true, 'kWh'); /* If verbose */

  /* Iterate over frameBuffer */
  data.split('\r\n').map(item => {

    /* get OBIS */
    const OBIS = item.match(/\d+-\d+:\d+.\d+.\d+\*\d+/);

    /* is this OBIS data? */
    if (OBIS) {
      /* Get value */
      const value = item.match(/\(([^)]+?)[\)*]/)[1];

      /* Is this an OBIS we know about? */
      if (OBIS[0] in ObisMapper) {

        /* Get details from mapper */
        const path = ObisMapper[OBIS[0]].path;
        const verbose = ObisMapper[OBIS[0]].verbose;

        /* Handle different kind of data */
        switch (path[0]) {


          /* State needs special treatment */
          case 'state':
            const byte = value.charCodeAt(0);
            addToResponse(response, path, verbose,
              {
                "idle": byte & (1 << 6) ? false /* 'above start-up' */ : true /* 'idle' */,

                outage: {
                  "L1": byte & (1 << 5) ? true : false,
                  "L2": byte & (1 << 4) ? true : false,
                  "L3": byte & (1 << 3) ? true : false
                },

                "error": byte & (1 << 0) ? true : false
              });
            break;

          /* serial is a sting */
          case 'serial':
            addToResponse(response, path, verbose, value);
            break;

          /* Everything else are floats */
          default:
            addToResponse(response, path, verbose, parseFloat(value));
        }

      }
    } else {

      /* This is not OBIS data. */
      /* If it's not ! or \x03, it must be device model! */
      if (item && item !== '!' && item !== '\x03') {

        addToResponse(response, ['model'], true, item);

      }
    }

  })

  /* Send response to caller */
  state.callback(response);

}

module.exports = { run };

