$(document).ready(function() {
    // Initialize date picker
    $('.datePicker').datepicker({
        format: "yyyy-mm-dd",
        autoclose: true
    });

    // Function to get the current date in GMT+5:45
    function getNepalTime(offsetMinutes) {
        let now = new Date();
        let localTime = now.getTime();
        let localOffset = now.getTimezoneOffset() * 60000; // Get local time offset in milliseconds
        let utc = localTime + localOffset; // Get UTC time in milliseconds

        // Calculate time for GMT+5:45 (345 minutes)
        let nepalTime = new Date(utc + (offsetMinutes * 60000));

        // Format the date as yyyy-mm-dd
        let year = nepalTime.getFullYear();
        let month = ("0" + (nepalTime.getMonth() + 1)).slice(-2); // Months are 0-indexed
        let day = ("0" + nepalTime.getDate()).slice(-2);

        return `${year}-${month}-${day}`;
    }

    // Set the default value for "From Date" and "To Date"
    let nepalTimeToday = getNepalTime(345); // Nepal's GMT offset is +5:45 (345 minutes)
    $('#date_from').val(nepalTimeToday);
    $('#date_to').val(nepalTimeToday);

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

    // Initialize a global array to hold all CSV data
    let allCsvData = [];

    // Form submission with AJAX
    $('#rainfallForm').on('submit', function(e) {
        e.preventDefault();

        var selectedStation = $('#station').val();
        var dateFrom = $('#date_from').val();
        var dateTo = $('#date_to').val();

        // Clear the output before new requests
        $('#output').html('');
        allCsvData = []; // Reset CSV data on each form submission

        if (new Date(dateFrom) > new Date(dateTo)) {
            $('#output').html('<p>Invalid date range. "From Date" cannot be after "To Date".</p>');
            return;
        }

        // Dates for range
        function getDatesInRange(startDate, endDate) {
            var dates = [];
            var currentDate = new Date(startDate);
            currentDate.setDate(currentDate.getDate() - 1); // Adjust to include one day before

            while (currentDate <= new Date(endDate)) {
                dates.push(currentDate.toISOString().split('T')[0]); // Format the date as yyyy-mm-dd
                currentDate.setDate(currentDate.getDate() + 1);
            }

            return dates;
        }

        var dates = getDatesInRange(dateFrom, dateTo);

        // Create an array to hold all AJAX request promises
        let requests = [];

        // Show the spinner and hide the download button
        $('#spinner').show();
        $('#downloadButton').hide();

        // Check if "All Stations" is selected
        if (selectedStation === "all") {
            // Collect data for each date and all stations
            dates.forEach(function(date) {
                $('#station option').each(function() {
                    var stationId = $(this).val();
                    var stationName = $(this).text();

                    if (stationId !== "all") { // Exclude "All Stations" option
                        // Collect data for this station and date
                        requests.push(collectDataForStation(stationId, stationName, date, allCsvData, dateFrom, dateTo));
                    }
                });
            });
        } else {
            // Single station selected, iterate through all dates
            var stationName = $('#station option:selected').text();
            dates.forEach(function(date) {
                requests.push(collectDataForStation(selectedStation, stationName, date, allCsvData, dateFrom, dateTo));
            });
        }

        // Wait for all requests to complete
        Promise.all(requests)
            .then(() => {
                // Sort all CSV data by date and time
                allCsvData.sort((a, b) => {
                    // Split into date and time
                    let [dateA, timeA] = a.split(',')[0].split(',');
                    let [dateB, timeB] = b.split(',')[0].split(',');

                    // Convert dates to comparable format
                    let dateComparison = new Date(dateA.split(',').reverse().join('-')) - new Date(dateB.split(',').reverse().join('-'));

                    // If dates are the same, compare by time
                    if (dateComparison === 0) {
                        return timeA.localeCompare(timeB); // Compare times
                    }

                    return dateComparison;
                });

                // Show the download button after all requests are completed
                $('#downloadButton').show();
            })
            .catch(error => {
                $('#output').append('<p>Some data retrieval failed. Please check the log.</p>');
                console.error('Error fetching data:', error);
            })
            .finally(() => {
                // Hide the spinner
                $('#spinner').hide();
            });
    });

    // Function to collect data for each station and date
    function collectDataForStation(stationId, stationName, date, allCsvData, dateFrom, dateTo) {
        return new Promise((resolve, reject) => {
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

                        // Only compare the date part (ignore time)
                        let dateOnlyObj = new Date(dateObj);
                        let dateOnlyFrom = new Date(dateFrom);
                        let dateOnlyTo = new Date(dateTo);

                        dateOnlyObj.setHours(0, 0, 0, 0); // Reset time to midnight
                        dateOnlyFrom.setHours(0, 0, 0, 0); // Reset time to midnight
                        dateOnlyTo.setHours(0, 0, 0, 0); // Reset time to midnight

                        // Only include the data if the date is between "From Date" and "To Date"
                        if (dateOnlyFrom <= dateOnlyObj && dateOnlyObj <= dateOnlyTo) {
                            // Push the formatted data into the allCsvData array
                            allCsvData.push(`${day}${month}${year},${hours}${minutes},${point}`);
                        }
                    });

                    resolve(); // Resolve the promise after data is processed
                },
                error: function() {
                    $('#output').append('<p>Failed to retrieve data for ' + stationName + ' station on ' + date + '.</p>');
                    resolve(); // Resolve the promise even on error
                }
            });
        });
    }

    // Function to trigger CSV download
    $('#downloadButton').on('click', function() {
        triggerCsvDownload(allCsvData);
    });

    function triggerCsvDownload(allCsvData) {
        // Sort all CSV data by date and time
        allCsvData.sort((a, b) => {
            // Split the rows by commas to extract date and time
            let [dateA, timeA] = a.split(',').slice(0, 2); 
            let [dateB, timeB] = b.split(',').slice(0, 2); 
            
            // Convert dates from ddmmyyyy to yyyy-mm-dd for comparison
            let formattedDateA = `${dateA.slice(4, 8)}-${dateA.slice(2, 4)}-${dateA.slice(0, 2)}`;
            let formattedDateB = `${dateB.slice(4, 8)}-${dateB.slice(2, 4)}-${dateB.slice(0, 2)}`;
            
            // Create Date objects with time for comparison
            let dateTimeA = new Date(`${formattedDateA}T${timeA.slice(0, 2)}:${timeA.slice(2, 4)}`);
            let dateTimeB = new Date(`${formattedDateB}T${timeB.slice(0, 2)}:${timeB.slice(2, 4)}`);
            
            // Compare the two Date objects
            return dateTimeA - dateTimeB;
        });

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
