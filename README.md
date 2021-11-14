# Read Voltcraft VSM-102 electricity meter(s) via rs485-to-telnet converter.

This module will contionusly query one or more [Voltcraft VSM-102](https://www.conrad.com/p/voltcraft-vsm-102-electricity-meter-3-phase-digital-mid-approved-no-1-pcs-125439) electricity meter(s) connected to an rs485-to-telnet converter. I use a [Chiyu BF-430](https://www.chiyu-tech.com/product-bf430-serial-to-tcp-ip-converter-rs485-to-tcp-ip-converter.html), but any similar device should work as long as there is no login required to access the bus. 

The electricity meter itself seems to be discontinued, but I have a few that I wanted to get readings from. So instead of hacking together a _"good enough"_ solution, I decided to actually package the code as an npm module for simple reuse. Especially since every time I hack something together for these meters, I have to wade through the incomplete, and in parts inaccurate, documentation for the device. This way I don't ever have to do that again.

__NOTE__: This module will relentlessly hammer the bus trying to get readings. It is therefor a very bad choice if your bus includes other devices!

## Example

```javascript
const meter = require('voltcraft-vsm-102-telnet');

meter.run({ host: 'hostname.example.com', port: 50000}, result => {
  console.log(result);
});
```

## Installation
```shellscript
npm install voltcfraft-vsm-102-telnet
```
## <a name="very-important"></a>VERY IMPORTANT!

### Buggy readings: Purchased power (kWh).
This Voltcraft VMS-102 contains a pretty serious bug related to meter readings of purcased power (kWh). The [documentation](https://asset.conrad.com/media10/add/160267/c1/-/gl/000125439ML01/manual-125439-voltcraft-vsm-102-electricity-meter-3-phase-digital-mid-approved-no-1-pcs.pdf) states _"Meter readings in kWh with 6 pre-decimal and 2 post-decimal digits"_. 

This is simply not true. In reality there are 5+2 digits, and the values does not roll over at 99999.99kWh. This gives readings of `?????.??*kWh`, which are not valid. 

Use option `verbose: true` to include these readings, knowing they are reported as parsed. This means a valua of `NaN` for invalid readings!

### Buggy readings: Total infed power (kW).
In addition, the OBIS `1-0:1.7.255*255` (__Li__: total infed power) does not always equal the sum of infed power for L1+L2+L3. It is therefor not normally included in response either. 

Use option `verbose: true` to include this value.

## API
```javascript
meter.run(options, callback);
```
### Parameter __options__
An object with the following properties:

|name     |required?| default   | description|
|------   |---------|---------  |------------------------------------------------------|
|host     |required |           |IP address or hostname of the rs485-to-telnet converter.
|port     |required |           |Telnet port of the rs485-to-telnet converter.
|serials  |optional |_\<none>_ |An array of device serial numbers to query. If there are more than one device is on the bus, this option is required. If only one device, this can be left out. (_example_: `serials: [ '11400529', '11400530' ]`)
|verbose  |optional |__false__  |__false__: Only report results when checksum matches. <br>__true__: Report all results __and__ all values.<br><br>Set this to __true__ to always report values, even if checksum does not match. This is a good way to calculate the signal-to-noise ratio on your rs485 bus.<br><br>__NOTE__: This also enables reporting of values not normally reported, as well as potentially buggy values. See [VERY IMPORTANT!](#very-important) for more details!

### Paramater __callback__
Callback function that will receive result. 

### The callback function receives the following objects:

#### Option __verbose: false__ (default)
```javascript
{
  ts: 1636906149995,      /* Timestamp. ms resolution */
  power: { 
    unit: 'kW',           /* Always 'kW' */
    L1: 3.0136,           /* OBIS 1-0:21.7.255*255 */
    L2: 4.0275,           /* OBIS 1-0:41.7.255*255 */
    L3: 2.6157,           /* OBIS 1-0:61.7.255*255 */
  },
  serial: '11400529'      /* OBIS 0-0:96.1.255*255 */
}
```

#### Option __verbose: true__
Only fields sent when __verbose: true__ is commented. The rest of the fealds are the same as above.
```javascript
{
  ts: 1636906115251,
  checksum: { 
    bcc: 120,             /* BCC as sent from device */
    lrc: 120,             /* LRC calculated over date sent from device */
    match: true           /* Do they match? */
  },
  power: { 
    unit: 'kW', 
    L1: 0.9239, 
    L2: 1.7303, 
    L3: 0.6819, 
    total: 3.3361         /* OBIS 1-0:1.7.255*255  */
  },
  energy: { 
    unit: 'kWh',          /* Always 'kWh' */
    total: NaN,           /* OBIS 1-0:1.8.0*255 */
    L1: 33399.95,         /* OBIS 1-0:2.1.7*255 */
    L2: 58744.73,         /* OBIS 1-0:4.1.7*255 */
    L3: 71589.76          /* OBIS 1-0:6.1.7*255 */
  },

  /* First line of device response. Presumably model+firmware? */
  model: 'EFR-M4-DRV004101222',

  /* OBIS 1-0:96.5.5*255 */
  state: {
    outage: {
      L1: false,          /* bit[5]: true if L1 outage. */ 
      L2: false,          /* bit[4]: true if L2 outage. */ 
      L3: false,          /* bit[3]: true if L2 outage. */ 
    }
    idle: false,          /* bit[6]: true if idle, false if 'above start-up' */
    error: false          /* bit[0]: true on error. */ 
  }
  serial: '11400529'
}
```
## License
[MIT](LICENSE.md) &copy; Thomas Hellström <rel@xed.se>