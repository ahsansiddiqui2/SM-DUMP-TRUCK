document.addEventListener("DOMContentLoaded", () => {
    // --- 1. DOM Elements ---
    const startBtn = document.getElementById("startSim");
    const logOutput = document.getElementById("log-output");
    const statsOutput = document.getElementById("stats-output");
    
    // Input Fields
    const numTrucksInput = document.getElementById("numTrucks");
    const numLoadersInput = document.getElementById("numLoaders");
    const numScalesInput = document.getElementById("numScales");
    const maxSimTimeInput = document.getElementById("maxSimTime");

    // --- 2. Simulation Logic ---
    startBtn.addEventListener("click", runSimulation);

    // Probability Distributions (Cumulative)
    const CUM_PROBS = {
        loading: [
            { time: 5, cum_prob: 0.3 },
            { time: 10, cum_prob: 0.8 }, // 0.3 + 0.5
            { time: 15, cum_prob: 1.0 }  // 0.8 + 0.2
        ],
        weighing: [
            { time: 12, cum_prob: 0.3 },
            { time: 14, cum_prob: 0.7 }, // 0.3 + 0.4
            { time: 16, cum_prob: 1.0 }  // 0.7 + 0.3
        ],
        travel: [
            { time: 40, cum_prob: 0.4 },
            { time: 60, cum_prob: 0.7 }, // 0.4 + 0.3
            { time: 80, cum_prob: 1.0 }  // 0.7 + 0.3
        ]
    };

    /**
     * Generates a random time based on the given probability table.
     * @param {string} type - 'loading', 'weighing', or 'travel'
     */
    function getRandomTime(type) {
        const rand = Math.random();
        const table = CUM_PROBS[type];
        
        for (const entry of table) {
            if (rand <= entry.cum_prob) {
                return entry.time;
            }
        }
        return table[table.length - 1].time; // Fallback
    }

    /**
     * The main simulation class
     */
    class Simulation {
        constructor(numTrucks, numLoaders, numScales, maxSimTime) {
            this.numTrucks = numTrucks;
            this.numLoaders = numLoaders;
            this.numScales = numScales;
            this.maxSimTime = maxSimTime;

            this.clock = 0.0;
            this.FEL = []; // Future Event List: [{ time, type, truckId }]
            
            // State Variables
            this.state = {
                LQ: 0, // Loader Queue length
                L: 0,  // Loaders busy
                WQ: 0, // Weigher Queue length
                W: 0   // Weighers busy
            };
            
            // Resource Queues
            this.loaderQueue = [];
            this.weigherQueue = [];
            
            // Truck states (for tracking)
            this.trucks = Array(numTrucks).fill(null).map((_, i) => ({
                id: i + 1,
                state: 'IDLE' // States: IDLE, LOADING, WEIGHING, TRAVELING, IN_LQ, IN_WQ
            }));

            // Statistics
            this.stats = {
                loaderBusyTime: 0.0,
                scaleBusyTime: 0.0,
            };

            this.log = [];
        }

        /**
         * Adds an event to the Future Event List, sorted by time.
         */
        addEvent(event) {
            this.FEL.push(event);
            this.FEL.sort((a, b) => a.time - b.time);
        }

        /**
         * Logs a message to the simulation log.
         * @param {string} msg 
         */
        logEvent(msg) {
            const timeStr = `[T=${this.clock.toFixed(2)}]`.padEnd(12);
            this.log.push(`${timeStr} ${msg}`);
        }

        /**
         * Initializes the simulation based on the problem description.
         */
        init() {
            this.logEvent("Simulation started.");
            
            // Check if we are running the specific problem from the prompt
            const isProblemSpecific = this.numTrucks === 6 && this.numLoaders === 2 && this.numScales === 1;

            if (isProblemSpecific) {
                this.logEvent("Using problem-specific initial state: 5 trucks at loaders, 1 at scale.");
                // 5 trucks at loaders
                let truckId = 1;
                for (let i = 0; i < 5; i++) {
                    if (this.state.L < this.numLoaders) {
                        // Start loading
                        this.state.L++;
                        this.trucks[truckId - 1].state = 'LOADING';
                        const loadTime = getRandomTime('loading');
                        this.addEvent({ time: this.clock + loadTime, type: 'EL', truckId });
                        this.logEvent(`DT${truckId} starts loading (finishes at T=${(this.clock + loadTime).toFixed(2)}). L=${this.state.L}`);
                    } else {
                        // Go to loader queue
                        this.state.LQ++;
                        this.loaderQueue.push(truckId);
                        this.trucks[truckId - 1].state = 'IN_LQ';
                        this.logEvent(`DT${truckId} enters loader queue (LQ=${this.state.LQ}).`);
                    }
                    truckId++;
                }

                // 1 truck at scale
                if (this.state.W < this.numScales) {
                    // Start weighing
                    this.state.W++;
                    this.trucks[truckId - 1].state = 'WEIGHING';
                    const weighTime = getRandomTime('weighing');
                    this.addEvent({ time: this.clock + weighTime, type: 'EW', truckId });
                    this.logEvent(`DT${truckId} starts weighing (finishes at T=${(this.clock + weighTime).toFixed(2)}). W=${this.state.W}`);
                } else {
                    // Go to weigh queue (unlikely at T=0 but good to have)
                    this.state.WQ++;
                    this.weigherQueue.push(truckId);
                    this.trucks[truckId - 1].state = 'IN_WQ';
                    this.logEvent(`DT${truckId} enters weigh queue (WQ=${this.state.WQ}).`);
                }
            } else {
                // General case: All trucks arrive at loader at T=0
                this.logEvent(`Using general initial state: ${this.numTrucks} trucks arrive at loader at T=0.`);
                for (let i = 1; i <= this.numTrucks; i++) {
                    this.addEvent({ time: 0, type: 'ALQ', truckId: i });
                }
            }
        }

        /**
         * Runs the simulation loop.
         */
        run() {
            this.init();
            let lastEventTime = 0.0;

            while (this.FEL.length > 0) {
                const event = this.FEL.shift(); // Get next event

                if (event.time > this.maxSimTime) {
                    this.clock = this.maxSimTime;
                    break; // Simulation ends
                }

                // --- Update Statistics based on time elapsed ---
                const timeDelta = event.time - lastEventTime;
                this.stats.loaderBusyTime += this.state.L * timeDelta;
                this.stats.scaleBusyTime += this.state.W * timeDelta;
                
                // --- Advance Clock and Process Event ---
                this.clock = event.time;
                lastEventTime = this.clock;

                switch (event.type) {
                    case 'ALQ': this.handleALQ(event); break;
                    case 'EL':  this.handleEL(event);  break;
                    case 'EW':  this.handleEW(event);  break;
                }
            }
            
            // Final stat update for the last period
            const timeDelta = this.clock - lastEventTime;
            this.stats.loaderBusyTime += this.state.L * timeDelta;
            this.stats.scaleBusyTime += this.state.W * timeDelta;
            
            this.logEvent(`Simulation ended at T=${this.clock.toFixed(2)}.`);
            return this.getFinalStats();
        }

        // --- Event Handlers ---

        handleALQ(event) {
            this.logEvent(`DT${event.truckId} arrives at loader queue.`);
            this.trucks[event.truckId - 1].state = 'IN_LQ';

            if (this.state.L < this.numLoaders) {
                // Loader is free
                this.state.L++;
                this.trucks[event.truckId - 1].state = 'LOADING';
                const loadTime = getRandomTime('loading');
                this.addEvent({ time: this.clock + loadTime, type: 'EL', truckId: event.truckId });
                this.logEvent(`DT${event.truckId} starts loading (finishes at T=${(this.clock + loadTime).toFixed(2)}). L=${this.state.L}`);
            } else {
                // Loaders are busy, join queue
                this.state.LQ++;
                this.loaderQueue.push(event.truckId);
                this.logEvent(`DT${event.truckId} joins loader queue (LQ=${this.state.LQ}).`);
            }
        }

        handleEL(event) {
            this.logEvent(`DT${event.truckId} ends loading. L=${this.state.L - 1}`);
            this.state.L--;
            this.trucks[event.truckId - 1].state = 'IN_WQ';

            // Check weigh scale
            if (this.state.W < this.numScales) {
                // Scale is free
                this.state.W++;
                this.trucks[event.truckId - 1].state = 'WEIGHING';
                const weighTime = getRandomTime('weighing');
                this.addEvent({ time: this.clock + weighTime, type: 'EW', truckId: event.truckId });
                this.logEvent(`DT${event.truckId} starts weighing (finishes at T=${(this.clock + weighTime).toFixed(2)}). W=${this.state.W}`);
            } else {
                // Scale is busy, join queue
                this.state.WQ++;
                this.weigherQueue.push(event.truckId);
                this.logEvent(`DT${event.truckId} joins weigh queue (WQ=${this.state.WQ}).`);
            }
            
            // Check loader queue
            if (this.state.LQ > 0) {
                const nextTruckId = this.loaderQueue.shift();
                this.state.LQ--;
                this.state.L++;
                this.trucks[nextTruckId - 1].state = 'LOADING';
                
                const loadTime = getRandomTime('loading');
                this.addEvent({ time: this.clock + loadTime, type: 'EL', truckId: nextTruckId });
                this.logEvent(`DT${nextTruckId} (from queue) starts loading (finishes at T=${(this.clock + loadTime).toFixed(2)}). L=${this.state.L}`);
            }
        }

        handleEW(event) {
            this.logEvent(`DT${event.truckId} ends weighing. W=${this.state.W - 1}`);
            this.state.W--;
            this.trucks[event.truckId - 1].state = 'TRAVELING';

            // Start traveling
            const travelTime = getRandomTime('travel');
            this.addEvent({ time: this.clock + travelTime, type: 'ALQ', truckId: event.truckId });
            this.logEvent(`DT${event.truckId} starts traveling (arrives at loader at T=${(this.clock + travelTime).toFixed(2)}).`);

            // Check weigh queue
            if (this.state.WQ > 0) {
                const nextTruckId = this.weigherQueue.shift();
                this.state.WQ--;
                this.state.W++;
                this.trucks[nextTruckId - 1].state = 'WEIGHING';

                const weighTime = getRandomTime('weighing');
                this.addEvent({ time: this.clock + weighTime, type: 'EW', truckId: nextTruckId });
                this.logEvent(`DT${nextTruckId} (from queue) starts weighing (finishes at T=${(this.clock + weighTime).toFixed(2)}). W=${this.state.W}`);
            }
        }

        /**
         * Calculates and returns final simulation statistics.
         */
        getFinalStats() {
            const totalLoaderAvailableTime = this.numLoaders * this.clock;
            const totalScaleAvailableTime = this.numScales * this.clock;

            const loaderUtilization = totalLoaderAvailableTime > 0 
                ? (this.stats.loaderBusyTime / totalLoaderAvailableTime) * 100 
                : 0;
            
            const scaleUtilization = totalScaleAvailableTime > 0
                ? (this.stats.scaleBusyTime / totalScaleAvailableTime) * 100
                : 0;

            return {
                totalTime: this.clock,
                loaderUtilization: loaderUtilization,
                scaleUtilization: scaleUtilization
            };
        }
    }

    /**
     * Main function to start, run, and display simulation.
     */
    function runSimulation() {
        // 1. Clear previous results
        logOutput.textContent = "";
        statsOutput.innerHTML = "<p>Running simulation...</p>";
        
        // 2. Get parameters
        const numTrucks = parseInt(numTrucksInput.value);
        const numLoaders = parseInt(numLoadersInput.value);
        const numScales = parseInt(numScalesInput.value);
        const maxSimTime = parseInt(maxSimTimeInput.value);

        // 3. Create and run simulation
        const sim = new Simulation(numTrucks, numLoaders, numScales, maxSimTime);
        const stats = sim.run();

        // 4. Display results
        logOutput.textContent = sim.log.join("\n");
        
        statsOutput.innerHTML = `
            <p>Simulation complete after <strong>${stats.totalTime.toFixed(2)} minutes</strong>.</p>
            <p>Loader Utilization: <strong>${stats.loaderUtilization.toFixed(2)}%</strong> (of ${numLoaders} loaders)</p>
            <p>Scale Utilization: <strong>${stats.scaleUtilization.toFixed(2)}%</strong> (of ${numScales} scales)</p>
        `;
        
        // Scroll log to bottom
        logOutput.scrollTop = logOutput.scrollHeight;
    }
});