$(document).ready(function() {
    // Initialize date picker
    $('.datePicker').datepicker({
        format: "yyyy-mm-dd",
        autoclose: true
    });

    // Get Nepal time (GMT +5:45)
    function getNepalTime(offsetMinutes) {
        const now = new Date();
        return new Date(now.getTime() + (offsetMinutes - now.getTimezoneOffset()) * 60000);
    }

    const nepalTimeToday = getNepalTime(345);
    $('#date_from, #date_to').val(nepalTimeToday.toISOString().split('T')[0]);

    let stations = [];

    // Fetch stations and populate dropdowns
    function loadStations() {
        $.getJSON('https://www.dhm.gov.np/frontend_dhm/hydrology/getRainfallFilter', function(response) {
            stations = response.data[0];
            populateDropdowns(stations);
        }).fail(function() {
            $('#basin, #station').html('<option value="">Failed to load data</option>');
        });
    }

    function populateDropdowns(stations) {
        const basins = [...new Set(stations.map(station => station.basin))];
        const districts = [...new Set(stations.map(station => station.district))];
        
        populateSelect('#basin', basins, 'All Basins');
        populateSelect('#district', districts, 'All Districts');
        populateStations(stations);

        $('#basin, #district').on('change', function() {
            const selectedBasin = $('#basin').val();
            const selectedDistrict = $('#district').val();

            const filteredStations = stations.filter(station => 
                (!selectedBasin || station.basin === selectedBasin) && 
                (!selectedDistrict || station.district === selectedDistrict)
            );

            populateStations(filteredStations);
        });
    }

    function populateSelect(selector, items, placeholder) {
        const $select = $(selector).empty().append(`<option value="">${placeholder}</option>`);
        const fragment = document.createDocumentFragment();
        
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            fragment.appendChild(option);
        });

        $select.append(fragment);
    }

    function populateStations(stationsList) {
        const $stationSelect = $('#station').empty().append('<option value="all">All Stations</option>');
        const fragment = document.createDocumentFragment();
        
        stationsList.forEach(station => {
            const option = document.createElement('option');
            option.value = station.series_id;
            option.textContent = station.name;
            fragment.appendChild(option);
        });

        $stationSelect.append(fragment);
    }

    loadStations();

    // Form submission handler
    $('#rainfallForm').on('submit', function(e) {
        e.preventDefault();
        
        const selectedStation = $('#station').val();
        const dateFrom = $('#date_from').val();
        const dateTo = $('#date_to').val();
        
        if (new Date(dateFrom) > new Date(dateTo)) {
            $('#output').html('<p>Invalid date range.</p>');
            return;
        }

        const dates = getDatesInRange(dateFrom, dateTo);
        let requests = [];

        if (selectedStation === "all") {
            $('#station option').each(function() {
                const stationId = $(this).val();
                if (stationId !== "all") {
                    requests.push(...dates.map(date => collectDataForStation(stationId, date, dateFrom, dateTo)));
                }
            });
        } else {
            requests.push(...dates.map(date => collectDataForStation(selectedStation, date, dateFrom, dateTo)));
        }

        $('#spinner').show();
        $('#downloadButton').hide();

        Promise.all(requests).then(() => {
            $('#downloadButton').show().one('click', () => {
                triggerCsvOrZipDownload(stationCsvData);
            });
        }).finally(() => {
            $('#spinner').hide();
        });
    });

    // Initialize global object to store CSV data by station
    let stationCsvData = {};

    // Collect data for each station
    function collectDataForStation(stationId, date, dateFrom, dateTo) {
        return new Promise((resolve, reject) => {
            $.post('https://www.dhm.gov.np/hydrology/getRainfallWatchBySeriesId', {
                date, period: 2, seriesid: stationId
            }, function(response) {
                const tableHTML = JSON.parse(response).data.table;
                const tempDiv = $('<div>').html(tableHTML);

                tempDiv.find('tbody tr').each(function() {
                    const dateText = $(this).find('td').eq(0).text().trim();
                    const point = $(this).find('td').eq(1).text().trim();

                    const dateObj = new Date(dateText);
                    const csvRow = formatCSVRow(dateObj, point);

                    if (!stationCsvData[stationId]) stationCsvData[stationId] = [];
                    if (isDateInRange(dateObj, dateFrom, dateTo)) stationCsvData[stationId].push(csvRow);
                });

                resolve();
            }).fail(() => {
                $('#output').append(`<p>Failed to retrieve data for station ${stationId} on ${date}.</p>`);
                resolve();
            });
        });
    }

    // Helper functions
    function formatCSVRow(dateObj, point) {
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        return `${day}${month}${year},${hours}${minutes},${point}`;
    }

    function isDateInRange(dateObj, dateFrom, dateTo) {
        const startDate = new Date(dateFrom);
        const endDate = new Date(dateTo);
        dateObj.setHours(0, 0, 0, 0);  // Normalize time for comparison
        return dateObj >= startDate && dateObj <= endDate;
    }

    function getDatesInRange(startDate, endDate) {
        let dates = [];
        let currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() - 1);

        while (currentDate <= new Date(endDate)) {
            dates.push(currentDate.toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return dates;
    }

    function triggerCsvOrZipDownload(stationCsvData) {
        const stationNames = Object.keys(stationCsvData);
        if (stationNames.length === 1) {
            triggerCsvDownload(stationNames[0], stationCsvData[stationNames[0]]);
        } else {
            triggerZipDownload(stationCsvData);
        }
    }

    function triggerCsvDownload(stationName, csvData) {
        const sortedCSVdata = sortCSV(csvData);
        const blob = new Blob([sortedCSVdata], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.href = url;
        link.download = `${stationName}_rainfall_data.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function triggerZipDownload(stationCsvData) {
        const zip = new JSZip();
        Object.keys(stationCsvData).forEach(stationName => {
            const csvData = sortCSV(stationCsvData[stationName]);
            zip.file(`${stationName}_rainfall_data.txt`, csvData);
        });

        zip.generateAsync({ type: 'blob' }).then(content => {
            const link = document.createElement('a');
            const url = URL.createObjectURL(content);

            link.href = url;
            link.download = 'rainfall_data.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    // Sorting and unique filtering for CSV data
    function sortCSV(csvData) {
        const sortedData = csvData.sort((a, b) => {
            const [dateA, timeA] = a.split(',').slice(0, 2);
            const [dateB, timeB] = b.split(',').slice(0, 2);
            const formattedDateA = `${dateA.slice(4, 8)}-${dateA.slice(2, 4)}-${dateA.slice(0, 2)}`;
            const formattedDateB = `${dateB.slice(4, 8)}-${dateB.slice(2, 4)}-${dateB.slice(0, 2)}`;
            return new Date(`${formattedDateA}T${timeA.slice(0, 2)}:${timeA.slice(2, 4)}`) - 
                   new Date(`${formattedDateB}T${timeB.slice(0, 2)}:${timeB.slice(2, 4)}`);
        });

        return Array.from(new Set(sortedData.map(row => row))).join('\n'); // Remove duplicates
    }
});
