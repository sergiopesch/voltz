# Component Reference

## Resistor
- Color code: Black=0 Brown=1 Red=2 Orange=3 Yellow=4 Green=5 Blue=6 Violet=7 Grey=8 White=9
- Tolerance band: Gold=5%, Silver=10%, Brown=1%
- Common values: 220Ω, 330Ω, 1kΩ, 4.7kΩ, 10kΩ, 100kΩ
- LED current limiting: R = (Vsupply - Vf) / If
  - Red LED: Vf=2.0V, If=20mA → R=150Ω at 5V
  - Blue/White LED: Vf=3.2V, If=20mA → R=90Ω at 5V (use 100Ω)
  - Green LED: Vf=2.1V, If=20mA → R=145Ω at 5V (use 150Ω)
- Pull-up/pull-down: typically 10kΩ

## Capacitor
- Electrolytic: polarized (longer leg = positive), 1µF–10000µF, voltage rated
- Ceramic: non-polarized, 1pF–100µF, common values 100nF (decoupling), 22pF (crystal)
- Decoupling: place 100nF ceramic as close to IC power pins as possible
- Smoothing: 10µF–100µF electrolytic on power supply rails
- Safety: discharge before handling, especially >25V electrolytics

## LED
- Anode (longer leg) → resistor → Vcc
- Cathode (shorter leg, flat side) → GND
- Forward voltage: Red=2.0V, Yellow=2.1V, Green=2.1V, Blue=3.2V, White=3.3V
- Typical current: 20mA standard, 2mA indicator
- Never connect without current-limiting resistor

## Transistor (NPN - 2N2222/BC547)
- Pinout (flat side facing you): Emitter, Base, Collector (EBC)
- Use as switch: base resistor 1kΩ-10kΩ, collector to load, emitter to GND
- Saturation voltage: ~0.2V (Vce_sat)
- Base-emitter voltage: ~0.7V
- Max current: 2N2222=800mA, BC547=100mA

## MOSFET (N-Channel - IRF520/IRLZ44N)
- Gate, Drain, Source pinout (varies by package — check datasheet)
- Logic-level: IRLZ44N fully on at 5V gate, IRF520 needs 10V
- Add 10kΩ pull-down on gate to prevent floating
- Flyback diode across inductive loads (motors, solenoids)

## Voltage Regulator (LM7805 / AMS1117-3.3)
- LM7805: Input→pin1, GND→pin2, Output→pin3 (5V out, needs Vin≥7V)
- AMS1117-3.3: GND→pin1, Output→pin2, Input→pin3 (3.3V out, needs Vin≥4.5V)
- Add 100nF ceramic caps on both input and output
- Max dropout: LM7805=2V, AMS1117=1.2V
- Heat: calculate power dissipation P=(Vin-Vout)*I, heatsink if >1W

## Op-Amp (LM358/LM741)
- Non-inverting amplifier: Gain = 1 + (Rf/R1)
- Inverting amplifier: Gain = -(Rf/R1)
- Voltage follower (buffer): connect output to inverting input
- Comparator mode: non-inverting > inverting → output high
- LM358: dual op-amp, single supply (0V to Vcc)
- LM741: single op-amp, needs dual supply (+/-V)

## 555 Timer
- Pinout: GND(1) TRIG(2) OUT(3) RESET(4) CTRL(5) THRES(6) DISCH(7) VCC(8)
- Astable mode (oscillator): f = 1.44 / ((R1 + 2*R2) * C)
- Monostable mode (one-shot): t = 1.1 * R * C
- Always connect pin 4 (RESET) to VCC, pin 5 (CTRL) to GND via 10nF
- Operating voltage: 4.5V–16V

## Arduino Uno
- ATmega328P, 16MHz, 5V logic
- Digital pins: 0-13 (0,1 = Serial), PWM: 3,5,6,9,10,11
- Analog inputs: A0-A5 (10-bit ADC, 0-1023)
- Pin current: 20mA per pin, 200mA total across all pins
- Built-in LED on pin 13
- Power: USB (5V), barrel jack (7-12V), Vin pin

## ESP32
- Dual-core 240MHz, WiFi + BLE
- Operating voltage: 3.3V (NOT 5V tolerant on most pins!)
- ADC: 12-bit on GPIO32-39 (ADC1), GPIO0,2,4,12-15,25-27 (ADC2 — unavailable during WiFi)
- PWM: any GPIO via LEDC, 16 channels
- Touch pins: T0-T9
- Boot mode: GPIO0 LOW during reset → flash mode
- Deep sleep: ~10µA, wake on timer, touch, or ext interrupt

## Servo Motor (SG90/MG996R)
- 3 wires: Brown/Black=GND, Red=VCC(5V), Orange/Yellow=Signal
- PWM signal: 50Hz (20ms period)
  - 1ms pulse = 0°, 1.5ms = 90°, 2ms = 180°
- SG90: 180°, plastic gears, 1.2kg·cm torque
- MG996R: 180°, metal gears, 11kg·cm torque
- Power from separate 5V supply, not Arduino pin (draws too much current)

## DC Motor + H-Bridge (L298N/L293D)
- L298N module: 2 motor channels, 5V–35V, 2A per channel
- Enable pin = PWM speed control
- IN1/IN2 = direction: HIGH/LOW=forward, LOW/HIGH=reverse, LOW/LOW=stop
- Always include flyback diodes (L293D has built-in, L298N doesn't)
- Motor power separate from logic power

## Relay Module
- Signal pin: LOW or HIGH triggers (check module — some are active-low)
- COM/NO/NC: COM-NO closes when triggered, COM-NC opens when triggered
- Coil voltage: match module voltage (5V or 3.3V)
- Optoisolated modules safer for microcontrollers
- Warning: mains voltage relays can kill — insulate all connections

## Shift Register (74HC595)
- Pinout: QB(1) QC(2) QD(3) QE(4) QF(5) QG(6) QH(7) GND(8)
  VCC(16) QA(15) SER(14) OE(13) RCLK(12) SRCLK(11) SRCLR(10) QH'(9)
- 3 pins from Arduino → 8 outputs: SER(data), SRCLK(shift clock), RCLK(latch)
- Cascade: connect QH' to next chip's SER for 16, 24, 32+ outputs
- OE (pin 13) LOW to enable outputs, SRCLR (pin 10) HIGH for normal operation

## I2C Bus
- 2 wires: SDA (data) + SCL (clock) + GND
- Pull-up resistors: 4.7kΩ on SDA and SCL to VCC
- Arduino: SDA=A4, SCL=A5 (Uno), SDA=20, SCL=21 (Mega)
- ESP32: default SDA=21, SCL=22 (configurable)
- Address scanner: use Wire library, scan 0x01-0x7F
- Speed: 100kHz (standard), 400kHz (fast)

## SPI Bus
- 4 wires: MOSI, MISO, SCK, CS (chip select)
- Arduino Uno: MOSI=11, MISO=12, SCK=13, CS=any digital pin
- Each device needs its own CS pin (active LOW)
- Faster than I2C (up to 10MHz+), full duplex
- No pull-ups needed, shorter wires than I2C
