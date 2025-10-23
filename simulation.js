document.addEventListener("DOMContentLoaded", () => {
    
    const startBtn = document.getElementById("startSim");
    const logOutput = document.getElementById("log-output");
    const statsOutput = document.getElementById("stats-output");
    const errorOutput = document.getElementById("error-output");
    
    
    const numTrucksInput = document.getElementById("numTrucks");
    const numLoadersInput = document.getElementById("numLoaders");
    const numScalesInput = document.getElementById("numScales");
    const maxSimTimeInput = document.getElementById("maxSimTime");

    
    const loadingDistInput = document.getElementById("loadingDist");
    const weighingDistInput = document.getElementById("weighingDist");
    const travelDistInput = document.getElementById("travelDist");

    
    startBtn.addEventListener("click", runSimulation);

    /**
     * Parses the distribution text from a textarea.
     * @param {string} text - The raw text (e.g., "5, 0.3\n10, 0.5")
     * @returns {Array} - An array of objects: [{ time: 5, prob: 0.3 }, ...]
     */
    function parseDistribution(text) {
        const dist = [];
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.trim() === "") continue; 
            
            const parts = line.split(',');
            if (parts.length !== 2) {
                throw new Error(`Invalid format: "${line}". Expected "time, probability".`);
            }
            
            const time = parseFloat(parts[0].trim());
            const prob = parseFloat(parts[1].trim());

            if (isNaN(time) || isNaN(prob)) {
                throw new Error(`Invalid numbers in: "${line}".`);
            }
            if (prob < 0 || prob > 1) {
                throw new Error(`Probability must be between 0 and 1 in: "${line}".`);
            }
            dist.push({ time, prob });
        }
        return dist;
    }

    /**
     * Creates a cumulative probability table from a parsed distribution.
     * @param {Array} dist - The output from parseDistribution
     * @param {string} name - The name of the distribution (for error messages)
     * @returns {Array} - A cumulative probability table: [{ time: 5, cum_prob: 0.3 }, ...]
     */
    function createCumulativeTable(dist, name) {
        const totalProb = dist.reduce((sum, item) => sum + item.prob, 0);
        if (Math.abs(totalProb - 1.0) > 0.001) { 
            throw new Error(`${name} probabilities sum to ${totalProb.toFixed(2)}, but must sum to 1.0.`);
        }

        let cum_prob = 0;
        const cumTable = [];
        for (const item of dist) {
            cum_prob += item.prob;
            cumTable.push({ time: item.time, cum_prob: cum_prob });
        }
        
        if (cumTable.length > 0) {
            cumTable[cumTable.length - 1].cum_prob = 1.0;
        }
        return cumTable;
    }

    /**
     * The main simulation class
     */
    class Simulation {
        constructor(numTrucks, numLoaders, numScales, maxSimTime, cumProbs) {
            this.numTrucks = numTrucks;
            this.numLoaders = numLoaders;
            this.numScales = numScales;
            this.maxSimTime = maxSimTime;
            this.cumProbs = cumProbs; 

            this.clock = 0.0;
            this.FEL = []; 
            
            
            this.state = {
                LQ: 0, 
                L: 0,  
                WQ: 0, 
                W: 0   
            };
            
            
            this.loaderQueue = [];
            this.weigherQueue = [];
            
            
            this.trucks = Array(numTrucks).fill(null).map((_, i) => ({
                id: i + 1,
                state: 'IDLE' 
            }));

            
            this.stats = {
                loaderBusyTime: 0.0,
                scaleBusyTime: 0.0,
            };

            this.log = [];
        }

        /**
         * Generates a random time based on the given probability table.
         * @param {string} type - 'loading', 'weighing', or 'travel'
         */
        getRandomTime(type) {
            const rand = Math.random();
            const table = this.cumProbs[type];
            
            for (const entry of table) {
                if (rand <= entry.cum_prob) {
                    return entry.time;
                }
            }
            return table[table.length - 1].time; 
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
            
            
            const isProblemSpecific = this.numTrucks === 6 && this.numLoaders === 2 && this.numScales === 1;

            if (isProblemSpecific) {
                this.logEvent("Using problem-specific initial state: 5 trucks at loaders, 1 at scale.");
                let truckId = 1;
                
                for (let i = 0; i < 5; i++) {
                    if (this.state.L < this.numLoaders) {
                        this.state.L++;
                        this.trucks[truckId - 1].state = 'LOADING';
                        const loadTime = this.getRandomTime('loading');
                        this.addEvent({ time: this.clock + loadTime, type: 'EL', truckId });
                        this.logEvent(`DT${truckId} starts loading (finishes at T=${(this.clock + loadTime).toFixed(2)}). L=${this.state.L}`);
                    } else {
                        this.state.LQ++;
                        this.loaderQueue.push(truckId);
                        this.trucks[truckId - 1].state = 'IN_LQ';
                        this.logEvent(`DT${truckId} enters loader queue (LQ=${this.state.LQ}).`);
                    }
                    truckId++;
                }
                
                if (this.state.W < this.numScales) {
                    this.state.W++;
                    this.trucks[truckId - 1].state = 'WEIGHING';
                    const weighTime = this.getRandomTime('weighing');
                    this.addEvent({ time: this.clock + weighTime, type: 'EW', truckId });
                    this.logEvent(`DT${truckId} starts weighing (finishes at T=${(this.clock + weighTime).toFixed(2)}). W=${this.state.W}`);
                } else {
                    this.state.WQ++;
                    this.weigherQueue.push(truckId);
                    this.trucks[truckId - 1].state = 'IN_WQ';
                    this.logEvent(`DT${truckId} enters weigh queue (WQ=${this.state.WQ}).`);
                }
            } else {
                
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
                const event = this.FEL.shift(); 

                if (event.time > this.maxSimTime) {
                    this.clock = this.maxSimTime;
                    break; 
                }

                
                const timeDelta = event.time - lastEventTime;
                this.stats.loaderBusyTime += this.state.L * timeDelta;
                this.stats.scaleBusyTime += this.state.W * timeDelta;
                
                
                this.clock = event.time;
                lastEventTime = this.clock;

                switch (event.type) {
                    case 'ALQ': this.handleALQ(event); break;
                    case 'EL':  this.handleEL(event);  break;
                    case 'EW':  this.handleEW(event);  break;
                }
            }
            
            
            const timeDelta = this.clock - lastEventTime;
            if (timeDelta > 0) {
                this.stats.loaderBusyTime += this.state.L * timeDelta;
                this.stats.scaleBusyTime += this.state.W * timeDelta;
            }
            
            this.logEvent(`Simulation ended at T=${this.clock.toFixed(2)}.`);
            return this.getFinalStats();
        }

        

        handleALQ(event) {
            this.logEvent(`DT${event.truckId} arrives at loader queue.`);
            this.trucks[event.truckId - 1].state = 'IN_LQ';

            if (this.state.L < this.numLoaders) {
                
                this.state.L++;
                this.trucks[event.truckId - 1].state = 'LOADING';
                const loadTime = this.getRandomTime('loading');
                this.addEvent({ time: this.clock + loadTime, type: 'EL', truckId: event.truckId });
                this.logEvent(`DT${event.truckId} starts loading (finishes at T=${(this.clock + loadTime).toFixed(2)}). L=${this.state.L}`);
            } else {
                
                this.state.LQ++;
                this.loaderQueue.push(event.truckId);
                this.logEvent(`DT${event.truckId} joins loader queue (LQ=${this.state.LQ}).`);
            }
        }

        handleEL(event) {
            this.logEvent(`DT${event.truckId} ends loading. L=${this.state.L - 1}`);
            this.state.L--;
            this.trucks[event.truckId - 1].state = 'IN_WQ';

            
            if (this.state.W < this.numScales) {
                
                this.state.W++;
                this.trucks[event.truckId - 1].state = 'WEIGHING';
                const weighTime = this.getRandomTime('weighing');
                this.addEvent({ time: this.clock + weighTime, type: 'EW', truckId: event.truckId });
                this.logEvent(`DT${event.truckId} starts weighing (finishes at T=${(this.clock + weighTime).toFixed(2)}). W=${this.state.W}`);
            } else {
                
                this.state.WQ++;
                this.weigherQueue.push(event.truckId);
                this.logEvent(`DT${event.truckId} joins weigh queue (WQ=${this.state.WQ}).`);
            }
            
            
            if (this.state.LQ > 0) {
                const nextTruckId = this.loaderQueue.shift();
                this.state.LQ--;
                this.state.L++;
                this.trucks[nextTruckId - 1].state = 'LOADING';
                
                const loadTime = this.getRandomTime('loading');
                this.addEvent({ time: this.clock + loadTime, type: 'EL', truckId: nextTruckId });
                this.logEvent(`DT${nextTruckId} (from queue) starts loading (finishes at T=${(this.clock + loadTime).toFixed(2)}). L=${this.state.L}`);
            }
        }

        handleEW(event) {
            this.logEvent(`DT${event.truckId} ends weighing. W=${this.state.W - 1}`);
            this.state.W--;
            this.trucks[event.truckId - 1].state = 'TRAVELING';

            
            const travelTime = this.getRandomTime('travel');
            this.addEvent({ time: this.clock + travelTime, type: 'ALQ', truckId: event.truckId });
            this.logEvent(`DT${event.truckId} starts traveling (arrives at loader at T=${(this.clock + travelTime).toFixed(2)}).`);

            
            if (this.state.WQ > 0) {
                const nextTruckId = this.weigherQueue.shift();
                this.state.WQ--;
                this.state.W++;
                this.trucks[nextTruckId - 1].state = 'WEIGHING';

                const weighTime = this.getRandomTime('weighing');
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
        
        logOutput.textContent = "";
        statsOutput.innerHTML = "<p>Running simulation...</p>";
        errorOutput.textContent = "";
        errorOutput.style.display = "none";
        
        try {
            
            const numTrucks = parseInt(numTrucksInput.value);
            const numLoaders = parseInt(numLoadersInput.value);
            const numScales = parseInt(numScalesInput.value);
            const maxSimTime = parseInt(maxSimTimeInput.value);

            
            const loadingDist = parseDistribution(loadingDistInput.value);
            const weighingDist = parseDistribution(weighingDistInput.value);
            const travelDist = parseDistribution(travelDistInput.value);
            
            const cumProbs = {
                loading: createCumulativeTable(loadingDist, "Loading Time"),
                weighing: createCumulativeTable(weighingDist, "Weighing Time"),
                travel: createCumulativeTable(travelDist, "Travel Time")
            };

            
            const sim = new Simulation(numTrucks, numLoaders, numScales, maxSimTime, cumProbs);
            const stats = sim.run();

            
            logOutput.textContent = sim.log.join("\n");
            
            statsOutput.innerHTML = `
                <p><span>Simulation complete after:</span> <strong>${stats.totalTime.toFixed(2)} min</strong></p>
                <p><span>Loader Utilization (${numLoaders} loaders):</span> <strong>${stats.loaderUtilization.toFixed(2)}%</strong></p>
                <p><span>Scale Utilization (${numScales} scales):</span> <strong>${stats.scaleUtilization.toFixed(2)}%</strong></p>
            `;
            
            
            logOutput.scrollTop = logOutput.scrollHeight;

        } catch (error) {
            
            statsOutput.innerHTML = `<p>Simulation failed. Check errors below.</p>`;
            errorOutput.textContent = error.message;
            errorOutput.style.display = "block";
        }
    }
});
