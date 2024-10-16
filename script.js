$(document).ready(function() {
    // Initialize date picker
    $('.datePicker').datepicker({
        format: "yyyy-mm-dd",
        autoclose: true
    });

    // Fetch station data and populate the basin and station select dropdowns
    function loadStations() {
        $.ajax({
            url: 'https://www.dhm.gov.np/frontend_dhm/hydrology/getRainfallFilter',
            type: 'GET',
            dataType: 'json',
            success: function(response) {
                var basinSelect = $('#basin');
                var stationSelect = $('#station');
                var stations = response.data[0]; // Assuming data is in response.data[0]

                // Find unique basins
                var basins = [...new Set(stations.map(station => station.basin))];

                // Populate basin dropdown with unique basins
                basinSelect.empty();
                basinSelect.append('<option value="">All Basins</option>');
                basins.forEach(function(basin) {
                    basinSelect.append('<option value="' + basin + '">' + basin + '</option>');
                });

                // Function to populate all stations
                function populateStations(stationsList) {
                    stationSelect.empty();
                    stationSelect.append('<option value="all">All Stations</option>');
                    stationsList.forEach(function(station) {
                        stationSelect.append('<option value="' + station.series_id + '">' + station.name + '</option>');
                    });
                }

                // Initially populate with all stations
                populateStations(stations);

                // When a basin is selected, filter stations based on the selected basin
                basinSelect.on('change', function() {
                    var selectedBasin = $(this).val();

                    if (selectedBasin) {
                        // Filter stations belonging to the selected basin
                        var filteredStations = stations.filter(station => station.basin === selectedBasin);
                        populateStations(filteredStations);
                    } else {
                        // Show all stations if no basin is selected
                        populateStations(stations);
                    }
                });
            },
            error: function() {
                $('#basin').html('<option value="">Failed to load basins</option>');
                $('#station').html('<option value="">Failed to load stations</option>');
            }
        });
    }

    // Load stations and basins on page load
    loadStations();

    // Form submission with AJAX
    $('#rainfallForm').on('submit', function(e) {
        e.preventDefault();

        var selectedStation = $('#station').val();
        var dateFrom = $('#date_from').val();
        var dateTo = $('#date_to').val();

        // Clear the output before new requests
        $('#output').html('');

        if (new Date(dateFrom) > new Date(dateTo)) {
            $('#output').html('<p>Invalid date range. "From Date" cannot be after "To Date".</p>');
            return;
        }

        // Dates for range (like previous code)
        function getDatesInRange(startDate, endDate) {
            var dates = [];
            var currentDate = new Date(startDate);

            while (currentDate <= new Date(endDate)) {
                dates.push(currentDate.toISOString().split('T')[0]); // Format the date as yyyy-mm-dd
                currentDate.setDate(currentDate.getDate() + 1);
            }

            return dates;
        }

        var dates = getDatesInRange(dateFrom, dateTo);

        // Initialize a global array to hold all CSV data
        let allCsvData = [];

        // Create an array to hold all AJAX request promises
        let requests = [];

        // Check if "All Stations" is selected
        if (selectedStation === "all") {
            // All stations selected - iterate over stations first, then dates
            $('#station option').each(function() {
                var stationId = $(this).val();
                var stationName = $(this).text();

                if (stationId !== "all") { // Exclude "All Stations" option
                    // Collect data for this station
                    requests.push(collectDataForStation(stationId, stationName, dates, allCsvData));
                }
            });
        } else {
            // Single station selected
            var stationName = $('#station option:selected').text();
            requests.push(collectDataForStation(selectedStation, stationName, dates, allCsvData));
        }

        // Wait for all requests to complete
        Promise.all(requests)
            .then(() => {
                // Trigger CSV download after all requests are completed
                triggerCsvDownload(allCsvData);
            })
            .catch(error => {
                $('#output').append('<p>Some data retrieval failed. Please check the log.</p>');
                console.error('Error fetching data:', error);
            });
    });

    // Function to collect data for each station and date
    function collectDataForStation(stationId, stationName, dates, allCsvData) {
        return new Promise((resolve, reject) => {
            let requestsCompleted = 0; // Count of completed requests

            dates.forEach(function(date) {
                var data = {
                    date: date,
                    period: 1,
                    seriesid: stationId
                };

                $.ajax({
                    type: 'POST',
                    url: 'https://www.dhm.gov.np/hydrology/getRainfallWatchBySeriesId', // Example URL
                    data: data,
                    success: function(response) {
                        // Parse the response and extract the table HTML
                        let tableHTML = JSON.parse(response).data.table;

                        // Create a temporary DOM element to manipulate the HTML content
                        let tempDiv = $('<div>').html(tableHTML);

                        // Find each table row and extract the date and point
                        tempDiv.find('tbody tr').each(function() {
                            let dateText = $(this).find('td').eq(0).text().trim(); // Get the date text
                            let point = $(this).find('td').eq(1).text().trim(); // Get the point value

                            // Convert the date to the desired format ddmmyyyy,hhmm
                            let dateObj = new Date(dateText);
                            let day = ("0" + dateObj.getDate()).slice(-2);
                            let month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
                            let year = dateObj.getFullYear();
                            let hours = ("0" + dateObj.getHours()).slice(-2);
                            let minutes = ("0" + dateObj.getMinutes()).slice(-2);

                            // Create the formatted date string
                            let formattedDate = `${day}${month}${year},${hours}${minutes}`;

                            // Push the formatted data into the allCsvData array
                            allCsvData.push(`${formattedDate},${point}`);
                        });

                        // Count completed requests
                        requestsCompleted++;

                        // Check if all requests for this station are completed
                        if (requestsCompleted === dates.length) {
                            resolve(); // Resolve the promise
                        }
                    },

                    error: function() {
                        $('#output').append('<p>Failed to retrieve data for ' + stationName + ' station on ' + date + '.</p>');
                        requestsCompleted++; // Count as completed even on error

                        // Check if all requests for this station are completed
                        if (requestsCompleted === dates.length) {
                            resolve(); // Resolve the promise even if there are errors
                        }
                    }
                });
            });
        });
    }

    // Function to trigger CSV download
    function triggerCsvDownload(allCsvData) {
        // Create a CSV string from the allCsvData array
        let csvString = 'Date,Time,Point\n' + allCsvData.join('\n');

        // Create a Blob from the CSV string
        let blob = new Blob([csvString], {
            type: 'text/csv;charset=utf-8;'
        });

        // Create a link element for downloading the CSV file
        let link = document.createElement('a');
        let url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'rainfall_data.csv'); // Specify the file name

        // Append the link to the body (required for Firefox)
        document.body.appendChild(link);

        // Programmatically click the link to trigger the download
        link.click();

        // Clean up by removing the link and revoking the object URL
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
});
